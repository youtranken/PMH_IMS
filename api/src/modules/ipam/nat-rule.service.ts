import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { escapeLike, pgErrorCode } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { IpAddressService } from './ip-address.service';
import { describePortRange, validateNatRule } from './nat-rules';
import { ipAddressTable, natRuleTable } from './ipam.schema';

export const NAT_PROTOCOLS = ['tcp', 'udp', 'both'] as const;
export type NatProtocol = (typeof NAT_PROTOCOLS)[number];

/** SQLSTATE của vi phạm EXCLUDE — Postgres dùng chung mã với vi phạm ràng buộc loại trừ. */
const PG_EXCLUSION_VIOLATION = '23P01';

export interface NatRuleRecord {
  id: string;
  deviceId: string;
  deviceCode: string | null;
  deviceName: string | null;
  siteCode: string | null;
  protocol: NatProtocol;
  externalFrom: number;
  externalTo: number;
  externalPorts: string;
  internalIp: string;
  internalPort: number;
  ipAddressId: string | null;
  /** Chủ của IP trong, tra qua hồ sơ IP — trả lời "port này dẫn tới máy của ai". */
  internalOwner: string | null;
  usedBy: string;
  reason: string;
  enabled: boolean;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NatRuleInput {
  deviceId: string;
  protocol: NatProtocol;
  externalFrom: number;
  externalTo: number;
  internalIp: string;
  internalPort: number;
  usedBy: string;
  reason: string;
  enabled?: boolean;
  note?: string | null;
}

/**
 * Sổ NAT / port-forward (story 5.3, FR-017).
 *
 * Bảng này tồn tại để trả lời đúng ba câu của auditor: **port nào mở, vì sao, cho ai**.
 * Mọi quyết định thiết kế ở đây quy về việc giữ ba câu đó luôn có câu trả lời DUY NHẤT —
 * nên `reason`/`usedBy` bắt buộc, và hai rule chồng port ngoài bị chặn ở tầng DB.
 */
@Injectable()
export class NatRuleService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly devices: DevicesApiService,
    private readonly addresses: IpAddressService,
    private readonly catalog: CatalogApiService,
  ) {}

  async list(filters: { deviceId?: string; siteId?: string; search?: string } = {}): Promise<
    NatRuleRecord[]
  > {
    const where: SQL[] = [isNull(natRuleTable.voidedAt)];
    if (filters.deviceId) where.push(eq(natRuleTable.deviceId, filters.deviceId));
    if (filters.search?.trim()) {
      const term = `%${escapeLike(filters.search.trim())}%`;
      where.push(
        or(
          sql`${natRuleTable.usedBy} ILIKE ${term}`,
          sql`${natRuleTable.reason} ILIKE ${term}`,
          sql`host(${natRuleTable.internalIp}) ILIKE ${term}`,
          sql`${natRuleTable.externalFrom}::text ILIKE ${term}`,
        ) as SQL,
      );
    }

    const rows = await this.db
      .select()
      .from(natRuleTable)
      .where(and(...where))
      .orderBy(asc(natRuleTable.externalFrom));
    const decorated = await this.decorate(rows);

    /**
     * Lọc theo site làm ở TẦNG ỨNG DỤNG, không join bảng `device`.
     *
     * Site của một rule là site của cái router mang nó, mà `device` là bảng của module khác —
     * join thẳng là phá AD-2/AD-3. Ở quy mô vài trăm rule thì lọc sau khi tra là đủ nhanh;
     * đắt hơn thì mới tính tới việc mở thêm hàm trên `devices.api`.
     */
    if (!filters.siteId) return decorated;
    const site = await this.siteCodeOf(filters.siteId);
    return decorated.filter((rule) => rule.siteCode === site);
  }

  listForDevice(deviceId: string): Promise<NatRuleRecord[]> {
    return this.list({ deviceId });
  }

  async findOne(id: string): Promise<NatRuleRecord> {
    return (await this.decorate([await this.requireAlive(id)]))[0];
  }

  async create(actor: string, input: NatRuleInput): Promise<NatRuleRecord> {
    await this.requireDraytek(input.deviceId);
    this.requireValid(input);
    const ipAddressId = await this.linkIp(input.internalIp);

    try {
      const row = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(natRuleTable)
          .values({
            deviceId: input.deviceId,
            protocol: input.protocol,
            externalFrom: input.externalFrom,
            externalTo: input.externalTo,
            internalIp: input.internalIp,
            internalPort: input.internalPort,
            ipAddressId,
            usedBy: input.usedBy.trim(),
            reason: input.reason.trim(),
            enabled: input.enabled ?? true,
            note: input.note?.trim() || null,
            createdBy: actor,
          })
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'nat.created',
          objectType: 'nat_rule',
          objectId: rows[0].id,
          detail: {
            deviceId: input.deviceId,
            ports: describePortRange(input.externalFrom, input.externalTo),
            internalIp: input.internalIp,
            reason: input.reason.trim(),
          },
        });
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, input);
    }
  }

  async update(actor: string, id: string, input: Partial<NatRuleInput>): Promise<NatRuleRecord> {
    const before = await this.requireAlive(id);
    const merged: NatRuleInput = {
      deviceId: input.deviceId ?? before.deviceId,
      protocol: (input.protocol ?? before.protocol) as NatProtocol,
      externalFrom: input.externalFrom ?? before.externalFrom,
      externalTo: input.externalTo ?? before.externalTo,
      internalIp: input.internalIp ?? hostOf(before.internalIp),
      internalPort: input.internalPort ?? before.internalPort,
      usedBy: input.usedBy ?? before.usedBy,
      reason: input.reason ?? before.reason,
      enabled: input.enabled ?? before.enabled,
      note: input.note ?? before.note,
    };
    /**
     * Kiểm trên giá trị ĐÃ TRỘN với bản ghi cũ, không phải trên mỗi phần gửi lên.
     *
     * Sửa mỗi `externalTo` mà kiểm riêng nó thì "8010 hợp lệ" — trong khi hàng sau khi sửa
     * lại là 8020-8010, ngược đầu. Đúng bài học của import thiết bị ở Epic 2.
     */
    this.requireValid(merged);
    if (input.deviceId) await this.requireDraytek(input.deviceId);

    const ipAddressId =
      input.internalIp !== undefined ? await this.linkIp(merged.internalIp) : before.ipAddressId;

    try {
      const row = await this.db.transaction(async (tx) => {
        const rows = await tx
          .update(natRuleTable)
          .set({
            deviceId: merged.deviceId,
            protocol: merged.protocol,
            externalFrom: merged.externalFrom,
            externalTo: merged.externalTo,
            internalIp: merged.internalIp,
            internalPort: merged.internalPort,
            ipAddressId,
            usedBy: merged.usedBy.trim(),
            reason: merged.reason.trim(),
            enabled: merged.enabled ?? true,
            note: merged.note?.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(natRuleTable.id, id))
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'nat.updated',
          objectType: 'nat_rule',
          objectId: id,
          detail: {
            ports: describePortRange(merged.externalFrom, merged.externalTo),
            internalIp: merged.internalIp,
            enabled: merged.enabled,
          },
        });
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, merged);
    }
  }

  /**
   * "Xóa" = ẩn kèm lý do (quyết định 2026-08-23), và ở bảng này lý do còn quan trọng hơn:
   * "port 8080 đóng ngày nào, ai đóng, vì sao" là câu hỏi sẽ có người hỏi.
   */
  async voidRule(actor: string, id: string, reason: string): Promise<void> {
    const before = await this.requireAlive(id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao gỡ rule này (vd "dịch vụ đã ngừng").',
      });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(natRuleTable)
        .set({ voidedAt: new Date(), voidedBy: actor, voidReason: text })
        .where(eq(natRuleTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'nat.voided',
        objectType: 'nat_rule',
        objectId: id,
        detail: {
          ports: describePortRange(before.externalFrom, before.externalTo),
          internalIp: hostOf(before.internalIp),
          reason: text,
        },
      });
    });
  }

  private requireValid(input: NatRuleInput): void {
    const errors = validateNatRule({
      externalFrom: input.externalFrom,
      externalTo: input.externalTo,
      internalIp: input.internalIp,
      internalPort: input.internalPort,
      usedBy: input.usedBy,
      reason: input.reason,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'NAT_INVALID', message: errors.join(' ') });
    }
  }

  /**
   * Rule NAT phải gắn vào một thiết bị CÓ THẬT. Không ép phải là Draytek ở tầng dữ liệu:
   * story nói "thiết bị Draytek", nhưng hôm nào PMH đổi sang hãng khác thì cuốn sổ vẫn phải
   * dùng được — chặn theo hãng chỉ tổ đẻ ra một loại thiết bị giả để lách.
   */
  private async requireDraytek(deviceId: string): Promise<void> {
    if (!(await this.devices.exists(deviceId))) {
      throw new BadRequestException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Thiết bị không tồn tại.',
      });
    }
  }

  /** Nối mềm sang hồ sơ IP nếu có — không có cũng lưu được, chỉ là mất đường bấm sang. */
  private async linkIp(internalIp: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: ipAddressTable.id })
      .from(ipAddressTable)
      .where(
        and(
          sql`host(${ipAddressTable.address}) = ${internalIp}`,
          isNull(ipAddressTable.voidedAt),
        ),
      );
    return rows[0]?.id ?? null;
  }

  /** Đổi id site → mã site, vì `devices.api` trả về MÃ chứ không trả id. */
  private async siteCodeOf(siteId: string): Promise<string | null> {
    const lists = await this.catalog.lists({ includeInactive: true });
    return lists.sites.find((site) => site.id === siteId)?.code ?? null;
  }

  private async requireAlive(id: string): Promise<typeof natRuleTable.$inferSelect> {
    const rows = await this.db
      .select()
      .from(natRuleTable)
      .where(and(eq(natRuleTable.id, id), isNull(natRuleTable.voidedAt)));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NAT_NOT_FOUND',
        message: 'Không tìm thấy rule NAT này (có thể đã gỡ).',
      });
    }
    return rows[0];
  }

  private async decorate(
    rows: (typeof natRuleTable.$inferSelect)[],
  ): Promise<NatRuleRecord[]> {
    const deviceIds = [...new Set(rows.map((row) => row.deviceId))];
    const devices = new Map(
      await Promise.all(
        deviceIds.map(async (id) => {
          const device = await this.devices.getById(id).catch(() => null);
          return [id, device] as const;
        }),
      ),
    );
    const ipIds = [...new Set(rows.map((row) => row.ipAddressId).filter(Boolean))] as string[];
    const ips = new Map(
      await Promise.all(
        ipIds.map(async (id) => {
          const ip = await this.addresses.findOne(id).catch(() => null);
          return [id, ip] as const;
        }),
      ),
    );

    return rows.map((row) => {
      const device = devices.get(row.deviceId);
      const ip = row.ipAddressId ? ips.get(row.ipAddressId) : null;
      return {
        id: row.id,
        deviceId: row.deviceId,
        deviceCode: device?.code ?? null,
        deviceName: device?.name ?? null,
        siteCode: device?.siteCode ?? null,
        protocol: row.protocol as NatProtocol,
        externalFrom: row.externalFrom,
        externalTo: row.externalTo,
        externalPorts: describePortRange(row.externalFrom, row.externalTo),
        internalIp: hostOf(row.internalIp),
        internalPort: row.internalPort,
        ipAddressId: row.ipAddressId,
        internalOwner: ip?.usedBy ?? ip?.deviceCode ?? null,
        usedBy: row.usedBy,
        reason: row.reason,
        enabled: row.enabled,
        note: row.note,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private translate(error: unknown, input: NatRuleInput): unknown {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      return new ConflictException({
        code: 'NAT_PORT_OVERLAP',
        message:
          `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} (${input.protocol.toUpperCase()}) ` +
          'đã có rule khác trên router này. Sổ NAT chỉ được có MỘT câu trả lời cho mỗi port — ' +
          'sửa rule cũ hoặc gỡ nó trước.',
      });
    }
    return error;
  }
}

/** Postgres trả `inet` kèm mask; UI luôn muốn địa chỉ trần. */
function hostOf(value: string): string {
  return value.split('/')[0];
}

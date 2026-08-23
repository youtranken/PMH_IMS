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
import { escapeLike, pgErrorCode, PG_CHECK_VIOLATION } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { IpAddressService } from './ip-address.service';
import {
  describePortRange,
  protocolsOverlap,
  rangesOverlap,
  validateNatRule,
} from './nat-rules';
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
  /** Chỉ có ở kết quả ghi: điều đáng nói nhưng không đủ để chặn (vd mở dải >1000 cổng). */
  warnings?: string[];
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
      const text = filters.search.trim();
      const term = `%${escapeLike(text)}%`;
      const conditions: SQL[] = [
        sql`${natRuleTable.usedBy} ILIKE ${term}`,
        sql`${natRuleTable.reason} ILIKE ${term}`,
        sql`host(${natRuleTable.internalIp}) ILIKE ${term}`,
      ];
      /**
       * Gõ một SỐ thì tìm theo port, và tìm cả BÊN TRONG khoảng.
       *
       * Bản trước chỉ so `external_from::text` — nên rule `8000-8010` không tìm thấy khi gõ
       * `8005` hay `8010`, và người tra kết luận là port đang trống (code review Epic 5,
       * finding 6). Người tạo rule mới còn được lỗi 409 cứu; auditor chỉ đọc thì nhận thẳng
       * một câu trả lời sai.
       */
      const port = Number(text);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        conditions.push(
          sql`${natRuleTable.externalFrom} <= ${port} AND ${natRuleTable.externalTo} >= ${port}`,
        );
        conditions.push(sql`${natRuleTable.internalPort} = ${port}`);
      }
      where.push(or(...conditions) as SQL);
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
    /**
     * Site không tra ra được (đã xóa, hoặc bookmark cũ mang id lạ) → trả RỖNG.
     *
     * Bản trước để `site = null` rồi lọc `siteCode === null`, nên nó trả về đúng những rule
     * của router KHÔNG gắn site — một tập khác hẳn, không rỗng, và auditor đọc thành "đây là
     * các rule của site X" (code review Epic 5, finding 3). Export dùng chung đường này nên
     * con số sai đi thẳng vào file nộp.
     */
    if (site === null) return [];
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
    // Chuẩn hóa IP TRƯỚC mọi thứ: `linkIp` so chuỗi thô với `host(address)`, nên một dấu cách
    // thừa là không nối được vào hồ sơ IP dù hồ sơ đó có thật (code review Epic 5, finding 5).
    const clean: NatRuleInput = { ...input, internalIp: input.internalIp.trim() };
    const warnings = this.requireValid(clean);
    await this.requireNoProtocolOverlap(clean, null);
    const ipAddressId = await this.linkIp(clean.internalIp);

    try {
      const row = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(natRuleTable)
          .values({
            deviceId: clean.deviceId,
            protocol: clean.protocol,
            externalFrom: clean.externalFrom,
            externalTo: clean.externalTo,
            internalIp: clean.internalIp,
            internalPort: clean.internalPort,
            ipAddressId,
            usedBy: clean.usedBy.trim(),
            reason: clean.reason.trim(),
            enabled: clean.enabled ?? true,
            note: clean.note?.trim() || null,
            createdBy: actor,
          })
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'nat.created',
          objectType: 'nat_rule',
          objectId: rows[0].id,
          detail: {
            deviceId: clean.deviceId,
            ports: describePortRange(clean.externalFrom, clean.externalTo),
            internalIp: clean.internalIp,
            reason: clean.reason.trim(),
          },
        });
        return rows[0];
      });
      return { ...(await this.decorate([row]))[0], warnings };
    } catch (error) {
      throw this.translate(error, clean);
    }
  }

  async update(actor: string, id: string, input: Partial<NatRuleInput>): Promise<NatRuleRecord> {
    const before = await this.requireAlive(id);
    const merged: NatRuleInput = {
      deviceId: input.deviceId ?? before.deviceId,
      protocol: (input.protocol ?? before.protocol) as NatProtocol,
      externalFrom: input.externalFrom ?? before.externalFrom,
      externalTo: input.externalTo ?? before.externalTo,
      internalIp: (input.internalIp ?? hostOf(before.internalIp)).trim(),
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
    const warnings = this.requireValid(merged);
    if (input.deviceId) await this.requireDraytek(input.deviceId);
    await this.requireNoProtocolOverlap(merged, id);

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
          /**
           * `isNull(voidedAt)` trong chính câu UPDATE, không chỉ ở `requireAlive` phía trên.
           *
           * Hai người cùng lúc: A gỡ rule, B bấm Lưu — không có điều kiện này thì bản sửa của
           * B ghi đè lên một hàng ĐÃ gỡ, đẻ ra một dòng audit `nat.updated` cho rule không còn
           * trong sổ, và bản sửa biến mất vĩnh viễn mà không ai biết (code review Epic 5,
           * finding 8). Có điều kiện thì người thua thấy lỗi ngay.
           */
          .where(and(eq(natRuleTable.id, id), isNull(natRuleTable.voidedAt)))
          .returning();
        if (rows.length === 0) {
          throw new ConflictException({
            code: 'NAT_ALREADY_REMOVED',
            message: 'Rule này vừa bị người khác gỡ. Tải lại danh sách rồi thao tác lại.',
          });
        }
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
      return { ...(await this.decorate([row]))[0], warnings };
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

  /**
   * Chỉ LỖI mới chặn. Cảnh báo (vd mở dải hơn 1000 cổng) được trả về để nơi gọi hiện cho
   * người dùng — chặn nó là mâu thuẫn với chính thông điệp "nếu đúng ý thì cứ lưu", và làm
   * dải port camera không bao giờ vào nổi sổ (code review Epic 5, finding 1).
   */
  private requireValid(input: NatRuleInput): string[] {
    const { errors, warnings } = validateNatRule({
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
    return warnings;
  }

  /**
   * Chặn `both` chồng lên `tcp`/`udp` (và ngược lại) trên cùng router.
   *
   * Ràng buộc `EXCLUDE` của DB so `protocol WITH =` nên nó KHÔNG thấy chuyện này — mà `both`
   * theo định nghĩa phủ cả hai giao thức. Không chặn thì sổ có hai câu trả lời cho TCP/8080,
   * đúng thứ bảng này sinh ra để tránh (code review Epic 5, finding 4).
   *
   * `tcp` vs `udp` vẫn cho qua: Draytek khai riêng hai giao thức cùng port là việc hợp lệ.
   */
  private async requireNoProtocolOverlap(
    input: NatRuleInput,
    excludeId: string | null,
  ): Promise<void> {
    const siblings = await this.db
      .select()
      .from(natRuleTable)
      .where(and(eq(natRuleTable.deviceId, input.deviceId), isNull(natRuleTable.voidedAt)));

    const clash = siblings.find(
      (row) =>
        row.id !== excludeId &&
        protocolsOverlap(row.protocol, input.protocol) &&
        rangesOverlap(row.externalFrom, row.externalTo, input.externalFrom, input.externalTo),
    );
    if (!clash) return;

    throw new ConflictException({
      code: 'NAT_PORT_OVERLAP',
      message:
        `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} ` +
        `(${input.protocol.toUpperCase()}) đụng rule đang có: ` +
        `${clash.protocol.toUpperCase()} ${describePortRange(clash.externalFrom, clash.externalTo)}. ` +
        'Sổ NAT chỉ được có MỘT câu trả lời cho mỗi port — sửa rule cũ hoặc gỡ nó trước.',
    });
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
    /**
     * Ràng buộc `nat_external_range_check` của DB — hàng rào cuối. Không map thì mọi đường
     * vào KHÔNG qua DTO HTTP (import Excel về sau, seed, module khác gọi lại) bung 500 thay
     * vì một câu tiếng Việt (code review Epic 5, finding 2).
     */
    if (pgErrorCode(error) === PG_CHECK_VIOLATION) {
      return new BadRequestException({
        code: 'NAT_INVALID',
        message: `Port ngoài ${describePortRange(input.externalFrom, input.externalTo)} không hợp lệ (phải từ 1 đến 65535, số đầu nhỏ hơn số cuối).`,
      });
    }
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

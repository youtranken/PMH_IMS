import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { pgErrorCode, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION } from '../../common/sql';
import { diffRecord, hasChanges } from '../../common/record-diff';
import { AuditWriterService } from '../audit/audit-writer.service';
import { DevicesApiService } from '../devices/devices.api';
import { enumerateHosts, parseAddress } from './ip-rules';
import { ipAddressTable, ipHistoryTable } from './ipam.schema';
import { SubnetService } from './subnet.service';

export const IP_STATUSES = ['free', 'assigned', 'suspect_dead', 'reclaimed'] as const;
export type IpStatus = (typeof IP_STATUSES)[number];

/** Trường được theo dõi trong lịch sử (AD-13). */
const TRACKED = ['address', 'deviceId', 'usedBy', 'assignedAt', 'status', 'note'] as const;

export interface IpAddressRecord {
  id: string;
  subnetId: string;
  address: string;
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  usedBy: string | null;
  assignedBy: string;
  assignedAt: string | null;
  status: IpStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IpAddressInput {
  subnetId: string;
  address: string;
  deviceId?: string | null;
  usedBy?: string | null;
  assignedAt?: string | null;
  status?: IpStatus;
  note?: string | null;
}

/** Một dòng trên màn "toàn bộ dải": hoặc là hồ sơ thật, hoặc là một ô trống. */
export type SubnetSlot =
  | ({ kind: 'record' } & IpAddressRecord)
  | { kind: 'free'; address: string };

/**
 * Hồ sơ IP (story 5.1, FR-018/FR-019). Chủ sở hữu bảng `ip_address` + `ip_history` (AD-3).
 */
@Injectable()
export class IpAddressService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly devices: DevicesApiService,
    private readonly subnets: SubnetService,
  ) {}

  /**
   * AC 5.1: "danh sách IP tổng theo subnet hiển thị cả đang dùng lẫn trống".
   *
   * Ô trống KHÔNG có hàng trong DB — chúng được suy ra từ dải trừ đi những địa chỉ đã có hồ
   * sơ. Tạo sẵn 254 hàng "free" cho mỗi /24 thì mỗi lần khai dải là đẻ ra hàng trăm hàng rỗng
   * phải dọn khi ẩn dải, và một hàng "trống" vẫn mang `assigned_by`, `created_at` — dữ liệu
   * giả vờ có nghĩa.
   */
  async listBySubnet(subnetId: string): Promise<SubnetSlot[]> {
    const cidr = await this.subnets.cidrOf(subnetId);
    const records = await this.listRecords(subnetId);
    const byAddress = new Map(records.map((row) => [row.address, row]));

    return enumerateHosts(cidr).map<SubnetSlot>((address) => {
      const record = byAddress.get(address);
      return record ? { kind: 'record', ...record } : { kind: 'free', address };
    });
  }

  /** Chỉ những IP CÓ hồ sơ, sắp theo thứ tự số học (nhờ kiểu `inet` của Postgres). */
  async listRecords(subnetId: string): Promise<IpAddressRecord[]> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.subnetId, subnetId), isNull(ipAddressTable.voidedAt)))
      .orderBy(asc(ipAddressTable.address));
    return this.decorate(rows);
  }

  /** IP của một thiết bị — panel IP trên trang thiết bị (story 5.4) hỏi cái này. */
  async listForDevice(deviceId: string): Promise<IpAddressRecord[]> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.deviceId, deviceId), isNull(ipAddressTable.voidedAt)))
      .orderBy(asc(ipAddressTable.address));
    return this.decorate(rows);
  }

  async findOne(id: string): Promise<IpAddressRecord> {
    return (await this.decorate([await this.requireAlive(id)]))[0];
  }

  async history(id: string): Promise<(typeof ipHistoryTable.$inferSelect)[]> {
    await this.requireAlive(id);
    return this.db
      .select()
      .from(ipHistoryTable)
      .where(eq(ipHistoryTable.ipAddressId, id))
      .orderBy(asc(ipHistoryTable.createdAt));
  }

  async create(actor: string, input: IpAddressInput): Promise<IpAddressRecord> {
    const cidr = await this.subnets.cidrOf(input.subnetId);
    const address = this.requireHost(input.address, cidr);
    await this.requireDevice(input.deviceId);
    const status = input.status ?? (input.deviceId || input.usedBy ? 'assigned' : 'free');

    try {
      const row = await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(ipAddressTable)
          .values({
            subnetId: input.subnetId,
            address,
            deviceId: input.deviceId || null,
            usedBy: input.usedBy?.trim() || null,
            assignedBy: actor,
            assignedAt: input.assignedAt || null,
            status,
            note: input.note?.trim() || null,
          })
          .returning();
        await this.audit.appendWithin(tx, {
          actor,
          action: 'ip.created',
          objectType: 'ip_address',
          objectId: rows[0].id,
          detail: { address, status },
        });
        await tx.insert(ipHistoryTable).values({
          ipAddressId: rows[0].id,
          action: 'ip.created',
          actor,
          toStatus: status,
          changes: { address, deviceId: input.deviceId ?? null, usedBy: input.usedBy ?? null },
        });
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, address, cidr);
    }
  }

  async update(
    actor: string,
    id: string,
    input: Partial<IpAddressInput>,
  ): Promise<IpAddressRecord> {
    const before = await this.requireAlive(id);
    const values: {
      address?: string;
      deviceId?: string | null;
      usedBy?: string | null;
      assignedAt?: string | null;
      note?: string | null;
    } = {};

    if (input.address !== undefined) {
      const cidr = await this.subnets.cidrOf(before.subnetId);
      values.address = this.requireHost(input.address, cidr);
    }
    if (input.deviceId !== undefined) {
      await this.requireDevice(input.deviceId);
      values.deviceId = input.deviceId || null;
    }
    if (input.usedBy !== undefined) values.usedBy = input.usedBy?.trim() || null;
    if (input.assignedAt !== undefined) values.assignedAt = input.assignedAt || null;
    if (input.note !== undefined) values.note = input.note?.trim() || null;
    /**
     * Trạng thái KHÔNG sửa được qua đây — phải đi `transition()` (story 5.2).
     * AC 5.2 nói rõ: "chuyển trạng thái qua transition(), không UPDATE status tự do". Để lọt
     * một đường sửa thẳng thì cái máy trạng thái chỉ còn là gợi ý.
     */
    if (input.status !== undefined && input.status !== before.status) {
      throw new BadRequestException({
        code: 'IP_STATUS_NEEDS_TRANSITION',
        message: 'Đổi trạng thái IP phải qua thao tác riêng, không sửa trực tiếp.',
      });
    }

    try {
      const row = await this.db.transaction(async (tx) => {
        const rows = await tx
          .update(ipAddressTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(ipAddressTable.id, id))
          .returning();
        const changes = diffRecord(TRACKED, before, rows[0]);
        await this.audit.appendWithin(tx, {
          actor,
          action: 'ip.updated',
          objectType: 'ip_address',
          objectId: id,
          detail: changes,
        });
        if (hasChanges(changes)) {
          await tx.insert(ipHistoryTable).values({
            ipAddressId: id,
            action: 'ip.updated',
            actor,
            fromStatus: before.status,
            toStatus: rows[0].status,
            changes,
          });
        }
        return rows[0];
      });
      return (await this.decorate([row]))[0];
    } catch (error) {
      throw this.translate(error, values.address ?? before.address, null);
    }
  }

  /**
   * "Xóa" = ẩn, có lý do (quyết định 2026-08-23).
   *
   * Chỉ dành cho hồ sơ NHẬP NHẦM. IP hết dùng thì đi đường vòng đời (thu hồi, story 5.2) —
   * ẩn một IP đang dùng là làm mất luôn cái lịch sử mà AC 5.2 đòi giữ vĩnh viễn.
   */
  async voidAddress(actor: string, id: string, reason: string): Promise<void> {
    const before = await this.requireAlive(id);
    const text = reason.trim();
    if (!text) {
      throw new BadRequestException({
        code: 'VOID_REASON_REQUIRED',
        message: 'Nói rõ vì sao ẩn hồ sơ này (vd "gõ nhầm địa chỉ").',
      });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(ipAddressTable)
        .set({ voidedAt: new Date(), voidedBy: actor, voidReason: text })
        .where(eq(ipAddressTable.id, id));
      await this.audit.appendWithin(tx, {
        actor,
        action: 'ip.voided',
        objectType: 'ip_address',
        objectId: id,
        detail: { address: before.address, reason: text },
      });
      await tx.insert(ipHistoryTable).values({
        ipAddressId: id,
        action: 'ip.voided',
        actor,
        fromStatus: before.status,
        changes: { reason: text },
      });
    });
  }

  private requireHost(value: string, cidr: string): string {
    const parsed = parseAddress(value);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: 'IP_INVALID',
        message:
          parsed.reason === 'leading_zero'
            ? 'Không viết số 0 đứng đầu (172.16.010.5 dễ bị hiểu nhầm). Viết 172.16.10.5.'
            : 'Địa chỉ IPv4 không hợp lệ. Ví dụ đúng: 172.16.10.5.',
      });
    }
    /**
     * Kiểm bằng danh sách địa chỉ CẤP ĐƯỢC, nên chặn luôn cả địa chỉ mạng và địa chỉ quảng
     * bá — hai thứ trigger của DB cho qua (chúng vẫn "nằm trong dải") nhưng gán cho máy nào
     * là máy đó không ra được mạng.
     */
    if (!enumerateHosts(cidr).includes(parsed.value)) {
      throw new BadRequestException({
        code: 'IP_OUT_OF_SUBNET',
        message: `Địa chỉ ${parsed.value} không cấp được trong dải ${cidr} (ngoài dải, hoặc là địa chỉ mạng/quảng bá).`,
      });
    }
    return parsed.value;
  }

  private async requireDevice(deviceId: string | null | undefined): Promise<void> {
    if (!deviceId) return;
    if (!(await this.devices.exists(deviceId))) {
      throw new BadRequestException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Thiết bị không tồn tại.',
      });
    }
  }

  private async requireAlive(id: string): Promise<typeof ipAddressTable.$inferSelect> {
    const rows = await this.db
      .select()
      .from(ipAddressTable)
      .where(and(eq(ipAddressTable.id, id), isNull(ipAddressTable.voidedAt)));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ IP này (có thể đã ẩn).',
      });
    }
    return rows[0];
  }

  /** Gắn mã/tên thiết bị qua `devices.api` — KHÔNG join thẳng bảng `device` (AD-2/AD-3). */
  private async decorate(
    rows: (typeof ipAddressTable.$inferSelect)[],
  ): Promise<IpAddressRecord[]> {
    const deviceIds = [...new Set(rows.map((row) => row.deviceId).filter(Boolean))] as string[];
    const devices = new Map(
      await Promise.all(
        deviceIds.map(async (id) => {
          const device = await this.devices.getById(id).catch(() => null);
          return [id, device] as const;
        }),
      ),
    );
    return rows.map((row) => {
      const device = row.deviceId ? devices.get(row.deviceId) : null;
      return {
        id: row.id,
        subnetId: row.subnetId,
        // Postgres trả `inet` kèm mask khi khác /32 — cắt bỏ để UI luôn thấy đúng địa chỉ.
        address: row.address.split('/')[0],
        deviceId: row.deviceId,
        deviceCode: device?.code ?? null,
        deviceName: device?.name ?? null,
        usedBy: row.usedBy,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt,
        status: row.status as IpStatus,
        note: row.note,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private translate(error: unknown, address: string, cidr: string | null): unknown {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException({
        code: 'IP_TAKEN',
        message: `Địa chỉ ${address} đã có hồ sơ trong dải này. Một IP chỉ có một chủ.`,
      });
    }
    // Trigger `ip_address_within_subnet` — hàng rào cuối ở tầng DB.
    if (pgErrorCode(error) === PG_CHECK_VIOLATION) {
      return new BadRequestException({
        code: 'IP_OUT_OF_SUBNET',
        message: cidr
          ? `Địa chỉ ${address} không nằm trong dải ${cidr}.`
          : `Địa chỉ ${address} không nằm trong dải của hồ sơ này.`,
      });
    }
    return error;
  }
}

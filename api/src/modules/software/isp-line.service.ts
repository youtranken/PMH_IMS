import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { effectiveOf } from '../../common/merge-effective';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { orderByStable, type SortQuery } from '../../common/sorting';
import {
  conflictOnUnique,
  PG_FOREIGN_KEY_VIOLATION,
  pgConstraint,
  pgErrorCode,
  searchNormLike,
} from '../../common/sql';
import { diffRecord, hasChanges, type RecordChanges } from '../../common/record-diff';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { ispLineHistoryTable, ispLineTable } from './software.schema';

export const ISP_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type IspStatus = (typeof ISP_STATUSES)[number];

/** Trường được theo dõi trong lịch sử (AD-13). */
const TRACKED = [
  'code',
  'provider',
  'bandwidth',
  'wanIp',
  'siteId',
  'deviceId',
  'hotline',
  'contractNo',
  'startDate',
  'note',
  'status',
] as const;

export interface IspLineRecord {
  id: string;
  code: string;
  /** Tên nhà mạng — bản sao do Postgres giữ khớp với danh mục (0074). */
  provider: string;
  providerId: string;
  bandwidth: string | null;
  wanIp: string | null;
  siteId: string | null;
  deviceId: string | null;
  hotline: string | null;
  contractNo: string | null;
  startDate: string | null;
  note: string | null;
  status: IspStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Bản ghi kèm nhãn đã tra sẵn — bảng cần MÃ site và MÃ thiết bị, không cần uuid. */
export interface IspLineListItem extends IspLineRecord {
  siteCode: string | null;
  deviceCode: string | null;
  deviceName: string | null;
}

export interface IspLineHistoryRecord {
  id: string;
  ispLineId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface IspLineInput {
  code?: string;
  providerId?: string;
  bandwidth?: string | null;
  wanIp?: string | null;
  siteId?: string | null;
  deviceId?: string | null;
  hotline?: string | null;
  contractNo?: string | null;
  startDate?: string | null;
  note?: string | null;
  status?: IspStatus;
}

export interface IspFilter {
  search?: string;
  siteId?: string;
  providerId?: string;
  status?: IspStatus;
}

/**
 * Đường truyền ISP (story 3.3, FR-010).
 *
 * Mục tiêu của story viết rất rõ: "đứt cáp lúc 2h sáng có hotline + số hợp đồng trong
 * 30 giây". Nên hotline và số hợp đồng là thứ hiện ngay trên danh sách, không giấu trong
 * trang chi tiết.
 *
 * Site lấy qua CatalogApiService, thiết bị qua DevicesApiService — không join chéo (AD-2).
 */
@Injectable()
export class IspLineService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
    private readonly devices: DevicesApiService,
    private readonly audit: AuditWriterService,
  ) {}

  // ─────────────────────────── Đọc ───────────────────────────

  async list(
    query: PageQuery,
    filter: IspFilter,
    sort: SortQuery<IspSortKey> = ISP_SORT_DEFAULT,
  ): Promise<Page<IspLineListItem>> {
    const where = buildWhere(filter);
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(ispLineTable)
        .where(where)
        .orderBy(...ispOrderBy(sort))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(ispLineTable).where(where),
    ]);
    return {
      items: await this.decorate(rows),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Toàn bộ kết quả theo bộ lọc, KHÔNG phân trang — chỉ dùng cho export xlsx (FR-028). */
  async listAll(
    filter: IspFilter,
    sort: SortQuery<IspSortKey> = ISP_SORT_DEFAULT,
  ): Promise<IspLineListItem[]> {
    const rows = await this.db
      .select()
      .from(ispLineTable)
      .where(buildWhere(filter))
      // Cùng thứ tự với màn hình: file tải về phải khớp thứ tự người dùng đang nhìn.
      .orderBy(...ispOrderBy(sort));
    return this.decorate(rows);
  }

  async findOne(id: string): Promise<IspLineListItem> {
    const rows = await this.db.select().from(ispLineTable).where(eq(ispLineTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'ISP_NOT_FOUND',
        message: 'Không tìm thấy đường truyền này.',
      });
    }
    return (await this.decorate(rows))[0];
  }

  /** Các đường ISP đang cắm vào một thiết bị — khu mở rộng trên trang thiết bị (AC 3.3). */
  async listForDevice(deviceId: string): Promise<IspLineListItem[]> {
    const rows = await this.db
      .select()
      .from(ispLineTable)
      .where(eq(ispLineTable.deviceId, deviceId))
      .orderBy(asc(ispLineTable.code));
    return this.decorate(rows);
  }

  async history(ispLineId: string): Promise<IspLineHistoryRecord[]> {
    const rows = await this.db
      .select()
      .from(ispLineHistoryTable)
      .where(eq(ispLineHistoryTable.ispLineId, ispLineId))
      .orderBy(desc(ispLineHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
    return rows as IspLineHistoryRecord[];
  }

  // ─────────────────────────── Ghi ───────────────────────────

  async create(actor: string, input: IspLineInput): Promise<IspLineRecord> {
    const values = await this.prepare(input, null);
    return this.db.transaction(async (tx) => {
      await this.assertDeviceWithin(tx, values, null);
      const created = await this.insertWithin(tx, values);
      await this.recordWithin(tx, actor, created.id, 'created', {
        code: { before: null, after: created.code },
      });
      return created;
    });
  }

  async update(actor: string, id: string, input: IspLineInput): Promise<IspLineRecord> {
    const before = await this.requireRow(id);
    const values = await this.prepare(input, id);
    const changes = diffRecord(TRACKED, before, values);
    if (!hasChanges(changes)) return toRecord(before);

    return this.db.transaction(async (tx) => {
      await this.assertDeviceWithin(tx, values, before.deviceId);
      const updated = await this.updateWithin(tx, id, values);
      await this.recordWithin(tx, actor, id, 'updated', changes);
      return updated;
    });
  }

  async recordWithin(
    tx: Tx,
    actor: string,
    ispLineId: string,
    action: string,
    changes: RecordChanges | Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(ispLineHistoryTable).values({ ispLineId, action, actor, changes });
    await this.audit.appendWithin(tx, {
      actor,
      action: `isp.${action}`,
      objectType: 'isp_line',
      objectId: ispLineId,
      detail: changes,
    });
  }

  private async insertWithin(tx: Tx, values: Record<string, unknown>): Promise<IspLineRecord> {
    try {
      const rows = await tx.insert(ispLineTable).values(values as never).returning();
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async updateWithin(
    tx: Tx,
    id: string,
    values: Record<string, unknown>,
  ): Promise<IspLineRecord> {
    try {
      const rows = await tx
        .update(ispLineTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(ispLineTable.id, id))
        .returning();
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translate(error);
    }
  }

  // ─────────────────────────── Nội bộ ───────────────────────────

  private async decorate(
    rows: (typeof ispLineTable.$inferSelect)[],
  ): Promise<IspLineListItem[]> {
    if (rows.length === 0) return [];
    const lists = await this.catalog.lists({ includeInactive: true });
    const sites = new Map(lists.sites.map((site) => [site.id, site]));

    /*
     * MỘT lượt hỏi cho cả trang. Bản trước gọi `getById` cho từng dòng, mà hàm đó tốn 8 truy
     * vấn — danh sách 30 đường truyền là 240 câu cho một lần mở.
     *
     * Hành vi với thiết bị hỏng dữ liệu KHÔNG đổi: vắng mặt trong map thì vẫn hiện
     * "(thiết bị không còn)". Đây là màn người ta mở lúc đang mất mạng, nên một hàng hỏng
     * không được làm sập cả bảng.
     */
    const devices = await this.devices.getByIds(
      rows.map((row) => row.deviceId).filter(Boolean) as string[],
    );

    const out: IspLineListItem[] = [];
    for (const row of rows) {
      let deviceCode: string | null = null;
      let deviceName: string | null = null;
      if (row.deviceId) {
        const device = devices.get(row.deviceId);
        if (device) {
          deviceCode = device.code;
          deviceName = device.name;
        } else {
          deviceCode = '(thiết bị không còn)';
        }
      }
      out.push({
        ...toRecord(row),
        siteCode: row.siteId ? (sites.get(row.siteId)?.code ?? null) : null,
        deviceCode,
        deviceName,
      });
    }
    return out;
  }

  private async prepare(
    input: IspLineInput,
    id: string | null,
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
      if (value !== undefined) values[key] = value;
    };

    put('code', input.code === undefined ? undefined : requireText(input.code, 'mã đường truyền'));
    put('bandwidth', text(input.bandwidth));
    put('wanIp', text(input.wanIp));
    put('siteId', input.siteId === undefined ? undefined : (input.siteId || null));
    put('deviceId', input.deviceId === undefined ? undefined : (input.deviceId || null));
    put('hotline', text(input.hotline));
    put('contractNo', text(input.contractNo));
    put('startDate', dateOnly(input.startDate, 'Ngày bắt đầu'));
    put('note', text(input.note));
    put('status', input.status);

    if (id === null) {
      if (values.code === undefined) {
        throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu mã đường truyền.' });
      }
      if (!input.providerId) {
        throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu nhà mạng.' });
      }
    }

    // Kiểm trên giá trị SAU KHI GHÉP với hồ sơ đang có, và ghép bằng `effectiveOf` chứ KHÔNG
    // bằng `??`: gửi chuỗi rỗng là bỏ gán, `??` sẽ lặng lẽ giữ lại site cũ để kiểm.
    const current = id ? await this.requireRow(id) : null;
    if (input.providerId) {
      Object.assign(values, await this.providerValues(input.providerId, current?.providerId ?? null));
    }
    const effective = effectiveOf(values);
    const siteId = effective<string | null>('siteId', current?.siteId ?? null);
    if (siteId) {
      const errors = await this.catalog.validateRefs({ siteId });
      if (errors.length > 0) {
        throw new BadRequestException({
          code: 'CATALOG_REF_INVALID',
          message: errors.join(' '),
        });
      }
    }
    return values;
  }

  /**
   * Nhà mạng phải có trong danh mục. Mục đã ngừng dùng chỉ qua được khi hồ sơ VỐN trỏ vào nó —
   * không thì một đường truyền cũ của nhà mạng đã thôi hợp tác không sửa được hotline nữa.
   *
   * Ghi cả `provider` (tên) vì FK kép (provider_id, provider) đòi hai ô khớp nhau; lịch sử vì
   * thế cũng ghi TÊN đổi, người đọc sổ không phải tra uuid.
   */
  private async providerValues(
    providerId: string,
    currentId: string | null,
  ): Promise<{ providerId: string; provider: string }> {
    const provider = await this.catalog.ispProvider(providerId);
    if (!provider) {
      throw new BadRequestException({
        code: 'CATALOG_REF_INVALID',
        message: 'Nhà mạng không có trong danh mục.',
      });
    }
    if (!provider.active && provider.id !== currentId) {
      throw new BadRequestException({
        code: 'CATALOG_REF_INVALID',
        message: `Nhà mạng "${provider.name}" đã ngừng dùng — chọn nhà mạng khác, hoặc bật lại trong Danh mục.`,
      });
    }
    return { providerId: provider.id, provider: provider.name };
  }

  /**
   * Kiểm thiết bị biên, TRONG transaction của lượt ghi và có khoá.
   *
   * ===== CHỈ KIỂM KHI LIÊN KẾT THẬT SỰ ĐỔI =====
   *
   * Bản đầu của bản sửa 08/09 viết `values.deviceId ?? current?.deviceId`, tức kiểm cả liên
   * kết CŨ. Hậu quả: một đường truyền đã nối vào máy X, sau đó X bị thanh lý — từ lúc đó
   * KHÔNG SỬA ĐƯỢC GÌ trên đường truyền đó nữa, kể cả sửa hotline, kể cả để gỡ chính liên
   * kết hỏng ấy ra. Hàng rào tự nhốt người dùng vào trong (rà soát 08/09, #1).
   *
   * Máy đã thanh lý mà vẫn còn đường truyền cắm vào là chuyện CÓ THẬT với dữ liệu cũ, và lối
   * thoát duy nhất là sửa được hồ sơ đó. Từ 11/09 dữ liệu MỚI không sinh ra tình trạng đó nữa
   * (`IspDeviceRetirement` gỡ liên kết ngay trong lượt thanh lý), nhưng dữ liệu cũ vẫn còn nên
   * lối thoát phải giữ.
   *
   * ===== VÌ SAO CHUYỂN VÀO TRONG TRANSACTION =====
   *
   * Trước đây câu kiểm nằm trong `prepare`, chạy trên pool trước khi transaction mở. Giữa lúc
   * nó trả lời "máy còn dùng được" và lúc câu `INSERT` chạy có một khoảng, đủ để một lượt
   * thanh lý lọt vào giữa — và đường truyền mới nối vào một máy vừa ra khỏi công ty, không
   * bên nào gặp lỗi. Xem `DevicesApiService.assertUsableWithin`.
   */
  private async assertDeviceWithin(
    tx: Tx,
    values: Record<string, unknown>,
    currentDeviceId: string | null,
  ): Promise<void> {
    const nextDeviceId = values.deviceId as string | null | undefined;
    if (nextDeviceId && nextDeviceId !== currentDeviceId) {
      await this.devices.assertUsableWithin(tx, nextDeviceId);
    }
  }

  private async requireRow(id: string): Promise<typeof ispLineTable.$inferSelect> {
    const rows = await this.db.select().from(ispLineTable).where(eq(ispLineTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'ISP_NOT_FOUND',
        message: 'Không tìm thấy đường truyền này.',
      });
    }
    return rows[0];
  }

  private translate(error: unknown): unknown {
    // Nhà mạng bị xoá hoặc đổi tên giữa lúc kiểm và lúc ghi: FK kép trả 23503.
    if (pgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION && isProviderFk(error)) {
      return new ConflictException({
        code: 'ISP_PROVIDER_CHANGED',
        message: 'Nhà mạng vừa được đổi tên hoặc xoá trong danh mục. Tải lại rồi chọn lại.',
      });
    }
    return conflictOnUnique(error, {
      code: 'ISP_CODE_TAKEN',
      message: 'Đã có đường truyền mang mã này (không phân biệt hoa-thường).',
    });
  }
}

/**
 * Cột được phép sắp xếp. Đây là WHITELIST — tên cột đi thẳng vào `ORDER BY`.
 *
 * Chỉ mở những cột nằm SẴN trong bảng `isp_line`. `siteCode`/`deviceCode`/`deviceName` hiển
 * thị trên bảng nhưng tra qua CatalogApiService/DevicesApiService — sắp theo chúng đòi join
 * sang bảng của module khác, vi phạm AD-2. Muốn theo site thì lọc theo site rồi sắp theo mã.
 */
export const ISP_SORT_KEYS = [
  'code',
  'provider',
  'hotline',
  'contractNo',
  'status',
] as const;
export type IspSortKey = (typeof ISP_SORT_KEYS)[number];
export const ISP_SORT_DEFAULT: SortQuery<IspSortKey> = { key: 'code', dir: 'asc' };

/** Mở ra cho `api/test/sort-index.spec.ts` đọc `EXPLAIN` của ĐÚNG câu này (0058). */
export function ispOrderBy(sort: SortQuery<IspSortKey>): SQL[] {
  const column = {
    code: ispLineTable.code,
    provider: ispLineTable.provider,
    hotline: ispLineTable.hotline,
    contractNo: ispLineTable.contractNo,
    status: ispLineTable.status,
  }[sort.key];
  // Xem `orderByStable` — khoá chốt hạ phải đi CÙNG HƯỚNG với cột đang sắp (0058).
  return orderByStable(sort.dir, column, ispLineTable.code);
}

function buildWhere(filter: IspFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    // Lúc đứt cáp người ta gõ bất cứ thứ gì nhớ được: mã, nhà mạng, IP, số hợp đồng. Cả bốn
    // nằm trong cột sinh `isp_line.search_norm` (0052), đã gấp dấu — B-01.
    parts.push(searchNormLike(ispLineTable, term));
  }
  if (filter.siteId) parts.push(eq(ispLineTable.siteId, filter.siteId));
  if (filter.providerId) parts.push(eq(ispLineTable.providerId, filter.providerId));
  if (filter.status) parts.push(eq(ispLineTable.status, filter.status));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/**
 * Cột `end_date` vẫn nằm trong bảng (migration chỉ tiến) nhưng KHÔNG ra khỏi API: đường truyền
 * không có hạn (Q-04), và một ngày cũ lộ ra ở client nào đó sẽ bị đọc thành hạn thật.
 */
function toRecord(row: typeof ispLineTable.$inferSelect): IspLineRecord {
  const { endDate: _retired, ...rest } = row;
  void _retired;
  return { ...rest, status: row.status as IspStatus };
}

function text(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dateOnly(
  value: string | null | undefined,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException({
      code: 'DATE_INVALID',
      message: `${label} phải là ngày hợp lệ.`,
    });
  }
  return trimmed;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `Thiếu ${label}.` });
  }
  return trimmed;
}

function isProviderFk(error: unknown): boolean {
  const constraint = pgConstraint(error);
  return constraint === 'isp_line_provider_id_fkey' || constraint === 'isp_line_provider_name_fkey';
}

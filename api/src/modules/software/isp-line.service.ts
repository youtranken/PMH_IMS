import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { isRealDateOnly } from '../../common/real-date';
import { HISTORY_PAGE_LIMIT, latestStatusEvents, type StatusEvent } from '../../common/history';
import { effectiveOf } from '../../common/merge-effective';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { orderByStable, type SortQuery } from '../../common/sorting';
import {
  conflictOnUnique,
  escapeLike,
  PG_FOREIGN_KEY_VIOLATION,
  pgConstraint,
  pgErrorCode,
  searchNormLike,
} from '../../common/sql';
import { diffRecord, hasChanges, type RecordChanges } from '../../common/record-diff';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CATALOG_REF_INACTIVE, CatalogApiService, inactiveRefMessage } from '../catalog/catalog.api';
import { DevicesApiService } from '../devices/devices.api';
import { ispLineHistoryTable, ispLineTable, ispLineWanIpTable } from './software.schema';
import { MAX_WAN_IPS, wanIpsOf } from './wan-ip';

export const ISP_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type IspStatus = (typeof ISP_STATUSES)[number];

/** Mặc định của màn danh sách: đường CÒN CHẠY — lúc sự cố không phải lọc bằng mắt đường đã thanh lý. */
const ISP_LIVE_STATUSES: IspStatus[] = ['active', 'suspended'];

/**
 * `?status=active,suspended`. Vắng / rỗng = không lọc (⌘K). Có chữ lạ thì cả tham số coi như
 * mặc định (Q-20): 400 thì cả màn thành trang lỗi, bỏ riêng phần lạ thì `?status=terminated,x`
 * lại bày đường đã thanh lý như thể người dùng chọn đích danh.
 */
export function ispStatusesOf(text: string | undefined): IspStatus[] {
  const parts = [...new Set((text ?? '').split(',').map((part) => part.trim()))];
  if (parts.every((part) => part === '')) return [];
  if (parts.some((part) => !(ISP_STATUSES as readonly string[]).includes(part))) {
    return [...ISP_LIVE_STATUSES];
  }
  return parts as IspStatus[];
}

/**
 * Trường được theo dõi trong lịch sử (AD-13). `wanIps` so dưới dạng chuỗi ghép ", " (xem
 * `joinWanIps`): `diffRecord` chỉ so giá trị đơn, và dòng lịch sử cần đọc được "a → a, b".
 */
const TRACKED = [
  'code',
  'provider',
  'bandwidth',
  'wanIps',
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
  /** Tên nhà mạng — bản sao do Postgres giữ khớp với danh mục (Q-11). */
  provider: string;
  providerId: string;
  bandwidth: string | null;
  /** IPv4 đơn, theo thứ tự người nhập; rỗng = chưa ghi IP (Q-20). */
  wanIps: string[];
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
  /** Vắng mặt = giữ nguyên IP đang có; mảng rỗng = xoá hết. */
  wanIps?: string[];
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
  /** Một trạng thái, hoặc nhiều trạng thái ngăn bằng dấu phẩy — xem `ispStatusesOf`. */
  status?: string;
}

/**
 * Đường truyền ISP (FR-010).
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

  /** Ghi chú dạng rõ của hồ sơ — két so giá trị đang cất với nó (FR-035). */
  async noteOf(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ note: ispLineTable.note })
      .from(ispLineTable)
      .where(eq(ispLineTable.id, id));
    return row?.note ?? null;
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

  /** Lần chuyển sang Đã thanh lý (`terminated`) gần nhất của từng đường truyền. */
  terminationEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return latestStatusEvents(
      this.db,
      {
        table: ispLineHistoryTable,
        ownerId: ispLineHistoryTable.ispLineId,
        actor: ispLineHistoryTable.actor,
        changes: ispLineHistoryTable.changes,
        createdAt: ispLineHistoryTable.createdAt,
      },
      ids,
      'terminated',
    );
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
    const wanIps = requireWanIps(input.wanIps) ?? [];
    return this.db.transaction(async (tx) => {
      await this.assertDeviceWithin(tx, values, null);
      const created = await this.insertWithin(tx, values);
      await this.replaceWanIpsWithin(tx, created.id, wanIps);
      await this.recordWithin(tx, actor, created.id, 'created', {
        code: { before: null, after: created.code },
      });
      return toRecord(created, wanIps);
    });
  }

  async update(actor: string, id: string, input: IspLineInput): Promise<IspLineRecord> {
    const before = await this.requireRow(id);
    const values = await this.prepare(input, id);
    const nextWanIps = requireWanIps(input.wanIps);
    const beforeWanIps = (await this.wanIpsByLine([id])).get(id) ?? [];
    const changes = diffRecord(
      TRACKED,
      { ...before, wanIps: joinWanIps(beforeWanIps) },
      nextWanIps === undefined ? values : { ...values, wanIps: joinWanIps(nextWanIps) },
    );
    if (!hasChanges(changes)) return toRecord(before, beforeWanIps);

    const wanChanged = 'wanIps' in changes && nextWanIps !== undefined;
    return this.db.transaction(async (tx) => {
      await this.assertDeviceWithin(tx, values, before.deviceId);
      // UPDATE hàng cha chạy TRƯỚC và luôn chạy (ít nhất `updated_at`): khoá hàng của nó xếp hàng
      // hai lượt sửa IP cùng một đường, nên lượt sau không chèn trùng vào giữa lượt trước.
      const updated = await this.updateWithin(tx, id, values);
      if (wanChanged) await this.replaceWanIpsWithin(tx, id, nextWanIps);
      await this.recordWithin(tx, actor, id, 'updated', changes);
      return toRecord(updated, wanChanged ? nextWanIps : beforeWanIps);
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

  private async insertWithin(tx: Tx, values: Record<string, unknown>): Promise<IspLineRow> {
    try {
      const rows = await tx.insert(ispLineTable).values(values as never).returning();
      return rows[0];
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async updateWithin(
    tx: Tx,
    id: string,
    values: Record<string, unknown>,
  ): Promise<IspLineRow> {
    try {
      const rows = await tx
        .update(ispLineTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(ispLineTable.id, id))
        .returning();
      return rows[0];
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Thay trọn danh sách IP WAN của một đường, giữ thứ tự người nhập ở `sort_order`. */
  private async replaceWanIpsWithin(tx: Tx, ispLineId: string, wanIps: string[]): Promise<void> {
    await tx.delete(ispLineWanIpTable).where(eq(ispLineWanIpTable.ispLineId, ispLineId));
    if (wanIps.length === 0) return;
    await tx
      .insert(ispLineWanIpTable)
      .values(wanIps.map((address, sortOrder) => ({ ispLineId, address, sortOrder })));
  }

  // ─────────────────────────── Nội bộ ───────────────────────────

  /** IP WAN của nhiều đường trong MỘT câu — danh sách và file Excel đọc theo trang. */
  private async wanIpsByLine(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    // `host()`: địa chỉ trần, không kèm "/32" — đúng chữ màn hình in và lịch sử so.
    const rows = await this.db
      .select({
        ispLineId: ispLineWanIpTable.ispLineId,
        address: sql<string>`host(${ispLineWanIpTable.address})`,
      })
      .from(ispLineWanIpTable)
      .where(inArray(ispLineWanIpTable.ispLineId, ids))
      .orderBy(asc(ispLineWanIpTable.sortOrder));
    for (const row of rows) {
      out.set(row.ispLineId, [...(out.get(row.ispLineId) ?? []), row.address]);
    }
    return out;
  }

  private async decorate(rows: IspLineRow[]): Promise<IspLineListItem[]> {
    if (rows.length === 0) return [];
    const wanIps = await this.wanIpsByLine(rows.map((row) => row.id));
    const lists = await this.catalog.lists({ includeInactive: true });
    const sites = new Map(lists.sites.map((site) => [site.id, site]));

    /*
     * MỘT lượt hỏi cho cả trang. Gọi `getById` cho từng dòng thì mỗi dòng tốn 8 truy vấn —
     * danh sách 30 đường truyền là 240 câu cho một lần mở.
     *
     * Thiết bị hỏng dữ liệu: vắng mặt trong map thì hiện
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
        ...toRecord(row, wanIps.get(row.id) ?? []),
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
      await this.catalog.assertRefs({ siteId }, current ? { siteId: current.siteId } : null);
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
        code: CATALOG_REF_INACTIVE,
        message: inactiveRefMessage('Nhà mạng', provider.name),
      });
    }
    return { providerId: provider.id, provider: provider.name };
  }

  /**
   * Kiểm thiết bị biên, TRONG transaction của lượt ghi và có khoá.
   *
   * ===== CHỈ KIỂM KHI LIÊN KẾT THẬT SỰ ĐỔI =====
   *
   * Đừng viết `values.deviceId ?? current?.deviceId`: nó kiểm cả liên kết CŨ. Hậu quả: một
   * đường truyền đã nối vào máy X, sau đó X bị thanh lý — từ lúc đó KHÔNG SỬA ĐƯỢC GÌ trên
   * đường truyền đó nữa, kể cả sửa hotline, kể cả để gỡ chính liên kết hỏng ấy ra. Hàng rào
   * tự nhốt người dùng vào trong.
   *
   * Máy đã thanh lý mà vẫn còn đường truyền cắm vào là chuyện CÓ THẬT với dữ liệu cũ, và lối
   * thoát duy nhất là sửa được hồ sơ đó. Dữ liệu MỚI không sinh ra tình trạng đó
   * (`IspDeviceRetirement` gỡ liên kết ngay trong lượt thanh lý), nhưng dữ liệu cũ vẫn còn nên
   * lối thoát phải giữ.
   *
   * ===== VÌ SAO KIỂM TRONG TRANSACTION =====
   *
   * Kiểm trong `prepare`, trên pool trước khi transaction mở, là để hở: giữa lúc nó trả lời
   * "máy còn dùng được" và lúc câu `INSERT` chạy có một khoảng, đủ để một lượt
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

  private async requireRow(id: string): Promise<IspLineRow> {
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
        message: 'Nhà mạng vừa được đổi tên hoặc xóa trong danh mục. Tải lại rồi chọn lại.',
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

/** Mở ra cho `api/test/sort-index.spec.ts` đọc `EXPLAIN` của ĐÚNG câu này. */
export function ispOrderBy(sort: SortQuery<IspSortKey>): SQL[] {
  const column = {
    code: ispLineTable.code,
    provider: ispLineTable.provider,
    hotline: ispLineTable.hotline,
    contractNo: ispLineTable.contractNo,
    status: ispLineTable.status,
  }[sort.key];
  // Xem `orderByStable` — khoá chốt hạ phải đi CÙNG HƯỚNG với cột đang sắp.
  return orderByStable(sort.dir, column, ispLineTable.code);
}

function buildWhere(filter: IspFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    // Lúc đứt cáp người ta gõ bất cứ thứ gì nhớ được: mã, nhà mạng, IP, số hợp đồng. Mã, nhà
    // mạng, số hợp đồng nằm trong cột sinh `isp_line.search_norm` (đã gấp dấu — B-01); IP WAN ở
    // bảng con nên tìm bằng truy vấn con — khớp BẤT KỲ IP nào của đường (Q-20). Ctrl+K gọi
    // đúng `?search=` này.
    parts.push(
      or(
        searchNormLike(ispLineTable, term),
        sql`${ispLineTable.id} IN (SELECT ${ispLineWanIpTable.ispLineId} FROM ${ispLineWanIpTable}
              WHERE host(${ispLineWanIpTable.address}) LIKE ${`%${escapeLike(term)}%`})`,
      ),
    );
  }
  if (filter.siteId) parts.push(eq(ispLineTable.siteId, filter.siteId));
  if (filter.providerId) parts.push(eq(ispLineTable.providerId, filter.providerId));
  const statuses = ispStatusesOf(filter.status);
  if (statuses.length > 0) parts.push(inArray(ispLineTable.status, statuses));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/**
 * Cột `end_date` vẫn nằm trong bảng (migration chỉ tiến) nhưng KHÔNG ra khỏi API: đường truyền
 * không có hạn (Q-04), và một ngày cũ lộ ra ở client nào đó sẽ bị đọc thành hạn thật.
 */
type IspLineRow = typeof ispLineTable.$inferSelect;

function toRecord(row: IspLineRow, wanIps: string[]): IspLineRecord {
  const { endDate: _retired, ...rest } = row;
  void _retired;
  return { ...rest, wanIps, status: row.status as IspStatus };
}

function joinWanIps(wanIps: string[]): string {
  return wanIps.join(', ');
}

/** `undefined` = client không gửi trường này → giữ nguyên IP đang có. */
function requireWanIps(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const wan = wanIpsOf(raw);
  if (wan.reason === 'range') {
    throw new BadRequestException({
      code: 'WAN_IP_RANGE',
      message: `Nhập từng IP, không nhập dải: ${wan.bad}.`,
    });
  }
  if (wan.reason === 'invalid') {
    throw new BadRequestException({
      code: 'WAN_IP_INVALID',
      message: `IP WAN "${wan.bad}" không phải một IPv4 (vd 113.161.10.20).`,
    });
  }
  if (wan.reason === 'too_many') {
    throw new BadRequestException({
      code: 'WAN_IP_TOO_MANY',
      message: `Một đường truyền ghi tối đa ${MAX_WAN_IPS} IP WAN.`,
    });
  }
  return wan.value;
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
  if (!isRealDateOnly(trimmed)) {
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

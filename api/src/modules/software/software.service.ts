import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import type { SortQuery } from '../../common/sorting';
import { conflictOnUnique, escapeLike } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { ExpiryApiService } from '../expiry/expiry.api';
import { CatalogApiService } from '../catalog/catalog.api';
import { diffRecord, hasChanges, type RecordChanges } from '../../common/record-diff';
import {
  validateSoftware,
  type LicenseModel,
  type SoftwareInputShape,
  type SoftwareKind,
  type SoftwareStatus,
} from './software-rules';
import {
  licenseAssignmentTable,
  softwareHistoryTable,
  softwareTable,
} from './software.schema';
import type {
  SoftwareFilter,
  SoftwareHistoryRecord,
  SoftwareListItem,
  SoftwareRecord,
} from './software.types';

/** Trường được theo dõi trong lịch sử (AD-13). */
const TRACKED = [
  'code',
  'name',
  'kind',
  'vendorId',
  'seatTotal',
  'startDate',
  'endDate',
  'note',
  'status',
] as const;

/**
 * Chủ sở hữu `software` + `software_history` (AD-3).
 * Nhà cung cấp lấy qua `CatalogApiService` — không join sang bảng `vendor` (AD-2).
 */
@Injectable()
export class SoftwareService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
    private readonly audit: AuditWriterService,
    private readonly expiry: ExpiryApiService,
  ) {}

  // ─────────────────────────── Đọc ───────────────────────────

  async list(
    query: PageQuery,
    filter: SoftwareFilter,
    sort: SortQuery<SoftwareSortKey> = SOFTWARE_SORT_DEFAULT,
  ): Promise<Page<SoftwareListItem>> {
    const where = buildWhere(filter);
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(softwareTable)
        .where(where)
        .orderBy(...softwareOrderBy(sort))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(softwareTable).where(where),
    ]);
    return {
      items: await this.decorate(rows),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Toàn bộ theo bộ lọc, không phân trang — chỉ dùng cho export xlsx (FR-028). */
  async listAll(
    filter: SoftwareFilter,
    sort: SortQuery<SoftwareSortKey> = SOFTWARE_SORT_DEFAULT,
  ): Promise<SoftwareListItem[]> {
    const rows = await this.db
      .select()
      .from(softwareTable)
      .where(buildWhere(filter))
      // Cùng thứ tự với màn hình: file tải về phải khớp thứ tự người dùng đang nhìn.
      .orderBy(...softwareOrderBy(sort));
    return this.decorate(rows);
  }

  async findOne(id: string): Promise<SoftwareListItem> {
    const rows = await this.db.select().from(softwareTable).where(eq(softwareTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SOFTWARE_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ phần mềm này.',
      });
    }
    return (await this.decorate(rows))[0];
  }

  async history(softwareId: string): Promise<SoftwareHistoryRecord[]> {
    const rows = await this.db
      .select()
      .from(softwareHistoryTable)
      .where(eq(softwareHistoryTable.softwareId, softwareId))
      .orderBy(desc(softwareHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
    return rows as SoftwareHistoryRecord[];
  }

  /** Mọi hồ sơ có hạn nằm trong [from, to] — cỗ máy expiry (story 3.4) hỏi qua api. */
  async findExpiringBetween(from: string, to: string): Promise<SoftwareListItem[]> {
    const rows = await this.db
      .select()
      .from(softwareTable)
      .where(
        and(
          // License VĨNH VIỄN không có end_date, nên tự nhiên nằm ngoài lời nhắc — đúng ý:
          // nhắc gia hạn một thứ mua đứt là lời nhắc sai, và nhắc sai vài lần thì người ta
          // bỏ qua mọi lời nhắc còn lại.
          sql`${softwareTable.endDate} IS NOT NULL`,
          sql`${softwareTable.endDate} >= ${from}`,
          sql`${softwareTable.endDate} <= ${to}`,
          // Hồ sơ đã bỏ thì thôi không nhắc nữa — nhắc thứ không ai định gia hạn là spam.
          sql`${softwareTable.status} <> 'retired'`,
        ),
      )
      .orderBy(asc(softwareTable.endDate));
    return this.decorate(rows);
  }

  // ─────────────────────────── Ghi ───────────────────────────

  async create(actor: string, input: SoftwareInputShape): Promise<SoftwareRecord> {
    const values = await this.prepare(input, null);
    return this.db.transaction(async (tx) => {
      const created = await this.insertWithin(tx, values);
      await this.recordWithin(tx, actor, created.id, 'created', {
        code: { before: null, after: created.code },
      });
      return created;
    });
  }

  async update(
    actor: string,
    id: string,
    input: SoftwareInputShape,
  ): Promise<SoftwareRecord> {
    const before = await this.requireRow(id);
    const values = await this.prepare(input, id);
    const changes = diffRecord(TRACKED, before, values);
    if (!hasChanges(changes)) return toRecord(before);

    return this.db.transaction(async (tx) => {
      const updated = await this.updateWithin(tx, id, values);
      await this.recordWithin(tx, actor, id, 'updated', changes);
      return updated;
    });
  }

  /**
   * Gia hạn (story 3.4): đẩy `end_date` sang mốc mới. Tách riêng khỏi `update` để tab Lịch sử
   * đọc ra "đã gia hạn tới ngày X" chứ không lẫn với mọi lần sửa hồ sơ khác.
   */
  async renew(actor: string, id: string, newEnd: string): Promise<SoftwareRecord> {
    const before = await this.requireRow(id);
    const errors = validateSoftware({
      kind: before.kind as SoftwareKind,
      licenseModel: before.licenseModel as LicenseModel,
      seatTotal: before.seatTotal,
      startDate: before.startDate,
      endDate: newEnd,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'SOFTWARE_INVALID', message: errors.join(' ') });
    }
    if (before.endDate && newEnd <= before.endDate) {
      throw new BadRequestException({
        code: 'RENEW_NOT_FORWARD',
        message: `Hạn mới (${newEnd}) phải sau hạn hiện tại (${before.endDate}). Sửa nhầm hạn thì dùng nút Sửa hồ sơ.`,
      });
    }
    return this.db.transaction(async (tx) => {
      const updated = await this.updateWithin(tx, id, { endDate: newEnd, status: 'active' });
      await this.recordWithin(tx, actor, id, 'renewed', {
        endDate: { before: before.endDate, after: newEnd },
      });
      /*
       * Sổ gia hạn dùng chung ghi Ở ĐÂY, trong chính transaction này (AC 3.4, rà soát 07/09 #7).
       *
       * Trước 08/09 chỉ đường `/expiry/renew` ghi `renewal_history`; nút Gia hạn trong trang hồ
       * sơ gọi thẳng hàm này và không ghi gì. `end_date` đổi, tab Lịch sử có dòng, toast xanh —
       * nhưng báo cáo cuối năm và khối "gia hạn gần đây" đọc `renewal_history` nên trả rỗng.
       *
       * `label` phải khớp đúng chuỗi mà `software-expiry-sources.ts` dựng, để hai cửa không đẻ
       * ra hai cách gọi tên cùng một hồ sơ trong cùng một bảng.
       */
      await this.expiry.recordRenewalWithin(tx, {
        objectKind: before.kind,
        objectId: id,
        label: `${before.code} — ${before.name}`,
        oldEnd: before.endDate,
        newEnd,
        actor,
      });
      return updated;
    });
  }

  async recordWithin(
    tx: Tx,
    actor: string,
    softwareId: string,
    action: string,
    changes: RecordChanges | Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(softwareHistoryTable).values({ softwareId, action, actor, changes });
    await this.audit.appendWithin(tx, {
      actor,
      action: `software.${action}`,
      objectType: 'software',
      objectId: softwareId,
      detail: changes,
    });
  }

  async insertWithin(tx: Tx, values: Record<string, unknown>): Promise<SoftwareRecord> {
    try {
      const rows = await tx.insert(softwareTable).values(values as never).returning();
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async updateWithin(
    tx: Tx,
    id: string,
    values: Record<string, unknown>,
  ): Promise<SoftwareRecord> {
    try {
      const rows = await tx
        .update(softwareTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(softwareTable.id, id))
        .returning();
      return toRecord(rows[0]);
    } catch (error) {
      throw this.translate(error);
    }
  }

  // ─────────────────────────── Nội bộ ───────────────────────────

  /** Gắn tên NCC + số seat đã dùng cho một trang kết quả (một lượt đọc, không N+1). */
  private async decorate(
    rows: (typeof softwareTable.$inferSelect)[],
  ): Promise<SoftwareListItem[]> {
    if (rows.length === 0) return [];
    const lists = await this.catalog.lists({ includeInactive: true });
    const vendors = new Map(lists.vendors.map((vendor) => [vendor.id, vendor]));
    const used = await this.seatUsage(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...toRecord(row),
      vendorName: row.vendorId ? (vendors.get(row.vendorId)?.name ?? null) : null,
      seatUsed: used.get(row.id) ?? 0,
    }));
  }

  /**
   * Số seat đang dùng của cả trang, một lượt đếm (story 3.2).
   * Query thẳng `license_assignment` là hợp lệ: cùng module `software` sở hữu cả hai bảng
   * (AD-3). Đi vòng qua service khác chỉ để đọc bảng của chính mình là vòng phụ thuộc thừa.
   */
  private async seatUsage(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ softwareId: licenseAssignmentTable.softwareId, used: count() })
      .from(licenseAssignmentTable)
      .where(
        and(
          inArray(licenseAssignmentTable.softwareId, ids),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .groupBy(licenseAssignmentTable.softwareId);
    return new Map(rows.map((row) => [row.softwareId, Number(row.used)]));
  }

  /** Chuẩn hóa + kiểm luật. Chỉ trả về trường CÓ MẶT trong `input`. */
  private async prepare(
    input: SoftwareInputShape,
    id: string | null,
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
      if (value !== undefined) values[key] = value;
    };

    put('code', input.code === undefined ? undefined : requireText(input.code, 'mã hồ sơ'));
    put('name', input.name === undefined ? undefined : requireText(input.name, 'tên hồ sơ'));
    put('kind', input.kind);
    put('licenseModel', input.licenseModel);
    put('vendorId', input.vendorId === undefined ? undefined : (input.vendorId || null));
    put('seatTotal', input.seatTotal === undefined ? undefined : (input.seatTotal ?? null));
    put('startDate', dateOnly(input.startDate, 'Ngày bắt đầu'));
    put('endDate', dateOnly(input.endDate, 'Ngày hết hạn'));
    put('note', text(input.note));
    put('status', input.status);

    if (id === null) {
      for (const required of ['code', 'name', 'kind'] as const) {
        if (values[required] === undefined) {
          throw new BadRequestException({
            code: 'FIELD_REQUIRED',
            message: `Thiếu ${LABEL[required]}.`,
          });
        }
      }
    }

    // Luật phải chạy trên giá trị SAU KHI GHÉP với hồ sơ đang có — sửa một trường vẫn có
    // thể làm cả hồ sơ thành không hợp lệ (bài học từ code review Epic 2).
    const current = id ? await this.requireRow(id) : null;
    const errors = validateSoftware({
      kind: (values.kind ?? current?.kind ?? 'other') as SoftwareKind,
      licenseModel: (values.licenseModel ??
        current?.licenseModel ??
        'subscription') as LicenseModel,
      seatTotal: (values.seatTotal ?? current?.seatTotal ?? null) as number | null,
      startDate: (values.startDate ?? current?.startDate ?? null) as string | null,
      endDate: (values.endDate ?? current?.endDate ?? null) as string | null,
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'SOFTWARE_INVALID', message: errors.join(' ') });
    }

    if (values.vendorId) {
      const refErrors = await this.catalog.validateRefs({ vendorId: values.vendorId as string });
      if (refErrors.length > 0) {
        throw new BadRequestException({
          code: 'CATALOG_REF_INVALID',
          message: refErrors.join(' '),
        });
      }
    }
    return values;
  }

  private async requireRow(id: string): Promise<typeof softwareTable.$inferSelect> {
    const rows = await this.db.select().from(softwareTable).where(eq(softwareTable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SOFTWARE_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ phần mềm này.',
      });
    }
    return rows[0];
  }

  private translate(error: unknown): unknown {
    return conflictOnUnique(error, {
      code: 'SOFTWARE_CODE_TAKEN',
      message: 'Đã có hồ sơ mang mã này (không phân biệt hoa-thường).',
    });
  }
}

const LABEL: Record<string, string> = {
  code: 'mã hồ sơ',
  name: 'tên hồ sơ',
  kind: 'loại hồ sơ',
};

/**
 * Cột được phép sắp xếp. Đây là WHITELIST — tên cột đi thẳng vào `ORDER BY`.
 *
 * Chỉ mở những cột nằm SẴN trong bảng `software`. `vendorId` không có ở đây: màn hình hiện
 * TÊN nhà cung cấp (`vendorName`), và tên đó đọc qua `CatalogApiService`, không phải cột của
 * bảng này — sắp theo nó phải join sang bảng của module khác, vi phạm AD-2. `seatUsed` cũng
 * không có: đó là số đếm từ `license_assignment`, không phải cột thật. `note` là chữ tự do,
 * không ai cần sắp theo nó.
 */
export const SOFTWARE_SORT_KEYS = [
  'code',
  'name',
  'kind',
  'seatTotal',
  'startDate',
  'endDate',
  'status',
] as const;
export type SoftwareSortKey = (typeof SOFTWARE_SORT_KEYS)[number];
export const SOFTWARE_SORT_DEFAULT: SortQuery<SoftwareSortKey> = { key: 'code', dir: 'asc' };

function softwareOrderBy(sort: SortQuery<SoftwareSortKey>): SQL[] {
  const column = {
    code: softwareTable.code,
    name: softwareTable.name,
    kind: softwareTable.kind,
    seatTotal: softwareTable.seatTotal,
    startDate: softwareTable.startDate,
    endDate: softwareTable.endDate,
    status: softwareTable.status,
  }[sort.key];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Chốt hạ bằng `code`: thiếu nó thì hai hồ sơ cùng giá trị có thể đổi chỗ nhau giữa hai
  // lần tải — sang trang 2 lại thấy đúng bản ghi vừa xem ở trang 1, hoặc mất hẳn một dòng.
  return sort.key === 'code' ? [primary] : [primary, asc(softwareTable.code)];
}

function buildWhere(filter: SoftwareFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    parts.push(
      or(
        sql`${softwareTable.code}::text ILIKE ${like}`,
        sql`${softwareTable.name} ILIKE ${like}`,
        sql`${softwareTable.note} ILIKE ${like}`,
      ),
    );
  }
  if (filter.kind) parts.push(eq(softwareTable.kind, filter.kind));
  if (filter.status) parts.push(eq(softwareTable.status, filter.status));
  if (filter.vendorId) parts.push(eq(softwareTable.vendorId, filter.vendorId));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

function toRecord(row: typeof softwareTable.$inferSelect): SoftwareRecord {
  return {
    ...row,
    kind: row.kind as SoftwareKind,
    licenseModel: row.licenseModel as LicenseModel,
    status: row.status as SoftwareStatus,
  };
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

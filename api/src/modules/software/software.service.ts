import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { isRealDateOnly } from '../../common/real-date';
import { HISTORY_PAGE_LIMIT, latestStatusEvents, type StatusEvent } from '../../common/history';
import { requireUnchangedSince } from '../../common/cas';
import { effectiveOf } from '../../common/merge-effective';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { orderByStable, type SortQuery } from '../../common/sorting';
import { conflictOnUnique, escapeLike, searchNormLike } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { ExpiryApiService } from '../expiry/expiry.api';
import { CatalogApiService } from '../catalog/catalog.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { isoDateInTz, viDate } from '../../common/today';
import { diffRecord, hasChanges, type RecordChanges } from '../../common/record-diff';
import {
  autoRetireOn,
  effectiveSoftwareStatus,
  normalizeWebsites,
  seatConflicts,
  supportsWebsites,
  validateAssignmentTerms,
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
  SoftwareDetailItem,
  SoftwareFilter,
  SoftwareHistoryRecord,
  SoftwareListItem,
  SoftwareRecord,
  SoftwareRetirement,
  SoftwareScreenItem,
} from './software.types';

/**
 * Đọc đúng MỘT dòng lịch sử mới nhất (lần chuyển sang Thanh lý) — không phải panel Lịch sử,
 * nên không dùng trần `HISTORY_PAGE_LIMIT` (xem `history-readers.spec.ts`).
 */
const LATEST_ONLY = 1;

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
    private readonly config: SystemConfigService,
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

  /**
   * Gắn mốc tự thanh lý (Q-13) cho các dòng trả ra MÀN HÌNH. Tách khỏi `decorate` vì
   * `findOne`/`list` còn phục vụ luồng ghi và file xuất, những chỗ không cần đọc cấu hình.
   */
  async present(items: SoftwareListItem[]): Promise<SoftwareScreenItem[]> {
    if (items.length === 0) return [];
    const graceDays = await this.config.getNumber('softwareAutoRetireGraceDays');
    return items.map((item) => ({
      ...item,
      autoRetireOn: autoRetireOn(item.status, item.endDate, graceDays),
    }));
  }

  /** Trang chi tiết: dòng màn hình + hồ sơ Thanh lý lúc nào, do ai. */
  async detail(id: string): Promise<SoftwareDetailItem> {
    const [item] = await this.present([await this.findOne(id)]);
    return { ...item, retirement: item.status === 'retired' ? await this.retirementOf(id) : null };
  }

  /**
   * Lần chuyển sang Thanh lý GẦN NHẤT trong lịch sử: dòng `auto-retired` của lượt quét, hoặc
   * dòng sửa có `status.after = retired`. Hồ sơ nhập thẳng ở trạng thái Thanh lý thì không có.
   */
  private async retirementOf(id: string): Promise<SoftwareRetirement | null> {
    const rows = await this.db
      .select({
        action: softwareHistoryTable.action,
        actor: softwareHistoryTable.actor,
        createdAt: softwareHistoryTable.createdAt,
      })
      .from(softwareHistoryTable)
      .where(
        and(
          eq(softwareHistoryTable.softwareId, id),
          sql`(${softwareHistoryTable.action} = 'auto-retired'
               OR ${softwareHistoryTable.changes} -> 'status' ->> 'after' = 'retired')`,
        ),
      )
      .orderBy(desc(softwareHistoryTable.createdAt))
      .limit(LATEST_ONLY);
    const row = rows[0];
    if (!row) return null;
    return { at: row.createdAt, by: row.actor, auto: row.action === 'auto-retired' };
  }

  /** Lần chuyển sang Thanh lý gần nhất của từng hồ sơ — bản theo mẻ của `retirementOf`. */
  retirementEvents(ids: string[]): Promise<Map<string, StatusEvent>> {
    return latestStatusEvents(
      this.db,
      {
        table: softwareHistoryTable,
        ownerId: softwareHistoryTable.softwareId,
        actor: softwareHistoryTable.actor,
        changes: softwareHistoryTable.changes,
        createdAt: softwareHistoryTable.createdAt,
      },
      ids,
      'retired',
    );
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

  /** Sổ gia hạn của một hồ sơ (hạn cũ → mới, hợp đồng, chi phí) — `expiry` là chủ bảng (AD-3). */
  async renewals(id: string) {
    const row = await this.requireRow(id);
    return this.expiry.historyFor(row.kind, id);
  }

  /**
   * Mọi hồ sơ có hạn nằm trong [from, to] — cỗ máy expiry hỏi qua api. `kind` lọc
   * trong SQL: mỗi loại là một nguồn hạn riêng, lọc bên JS là chạy lại cả câu + `decorate` cho
   * từng loại ở mỗi lượt mở màn / mail tổng hợp.
   */
  async findExpiringBetween(
    from: string,
    to: string,
    kind?: SoftwareKind,
  ): Promise<SoftwareListItem[]> {
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
          // Thanh lý thì không ai định gia hạn. Hết hạn vẫn lấy để màn hình hiện mục quá hạn;
          // mail digest tự bỏ qua nó qua `quietInDigest` (DOM-03).
          sql`${softwareTable.status} <> 'retired'`,
          kind ? eq(softwareTable.kind, kind) : undefined,
        ),
      )
      .orderBy(asc(softwareTable.endDate));
    return this.decorate(rows);
  }

  // ─────────────────────────── Ghi ───────────────────────────

  /**
   * Lượt dọn định kỳ (DOM-03, Q-13): đưa trạng thái về đúng với hạn theo ngày `today`. Mỗi hồ sơ
   * đổi trạng thái có một dòng lịch sử của `system`, để tab Lịch sử trả lời được "ai chuyển nó".
   * Hết hạn quá `graceDays` ngày thì tự Thanh lý và gỡ ghế; `graceDays <= 0` là tắt bước đó.
   * Hồ sơ đã Thanh lý không bao giờ bị lượt này kéo ra.
   */
  async syncExpiryStatuses(
    today: string,
    graceDays: number,
  ): Promise<{ expired: number; reactivated: number; retired: number }> {
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .update(softwareTable)
        .set({ status: 'expired_ok', updatedAt: new Date() })
        .where(
          and(
            eq(softwareTable.status, 'active'),
            sql`${softwareTable.endDate} IS NOT NULL`,
            sql`${softwareTable.endDate} < ${today}`,
          ),
        )
        .returning({ id: softwareTable.id });
      const reactivated = await tx
        .update(softwareTable)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(softwareTable.status, 'expired_ok'),
            sql`(${softwareTable.endDate} IS NULL OR ${softwareTable.endDate} >= ${today})`,
          ),
        )
        .returning({ id: softwareTable.id });
      for (const row of expired) {
        await this.recordWithin(tx, 'system', row.id, 'expired', {
          status: { before: 'active', after: 'expired_ok' },
        });
      }
      for (const row of reactivated) {
        await this.recordWithin(tx, 'system', row.id, 'reactivated', {
          status: { before: 'expired_ok', after: 'active' },
        });
      }
      // Chạy SAU bước Hết hạn: hồ sơ qua hạn lâu mà chưa từng được quét đi thẳng tới Thanh lý.
      const retired =
        graceDays > 0
          ? await tx
              .update(softwareTable)
              .set({ status: 'retired', updatedAt: new Date() })
              .where(
                and(
                  eq(softwareTable.status, 'expired_ok'),
                  sql`${softwareTable.endDate} < ${today}::date - ${graceDays}::int`,
                ),
              )
              .returning({ id: softwareTable.id })
          : [];
      for (const row of retired) {
        await this.recordWithin(tx, 'system', row.id, 'auto-retired', {
          status: { before: 'expired_ok', after: 'retired' },
        });
        await this.releaseAllSeatsWithin(tx, 'system', row.id);
      }
      return {
        expired: expired.length,
        reactivated: reactivated.length,
        retired: retired.length,
      };
    });
  }

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
    // Khôi phục hồ sơ đã Thanh lý (Q-13) phải kèm hạn còn hiệu lực: để hạn cũ thì nó về Hết
    // hạn rồi lượt quét kế tiếp lại tự thanh lý, và các ghế người dùng vừa gán lại bị gỡ.
    if (before.status === 'retired' && values.status === 'expired_ok') {
      throw new BadRequestException({
        code: 'RESTORE_NEEDS_FUTURE_END',
        message: 'Khôi phục hồ sơ đã thanh lý cần ngày hết hạn mới từ hôm nay trở đi.',
      });
    }
    const changes: RecordChanges = {
      ...diffRecord(TRACKED, before, values),
      ...websitesChange(before.websites, values.websites as string[] | undefined),
    };
    if (!hasChanges(changes)) return toRecord(before);

    return this.db.transaction(async (tx) => {
      // `prepare` tính lại trạng thái theo hạn từ ảnh chụp ngoài transaction: một lượt thanh
      // lý commit vào giữa sẽ bị tính đè thành "Đang dùng".
      await this.requireUnchangedWithin(tx, before);
      await this.requireSeatsFitWithin(tx, before, values);
      const updated = await this.updateWithin(tx, id, values);
      await this.recordWithin(tx, actor, id, 'updated', changes);
      if (values.status === 'retired' && before.status !== 'retired') {
        await this.releaseAllSeatsWithin(tx, actor, id);
      }
      return updated;
    });
  }

  /**
   * Gia hạn: đẩy `end_date` sang mốc mới. Tách riêng khỏi `update` để tab Lịch sử
   * đọc ra "đã gia hạn tới ngày X" chứ không lẫn với mọi lần sửa hồ sơ khác.
   */
  /**
   * `withinSeats` (SW-049): việc kéo ghế theo, chạy TRONG transaction gia hạn và trả số ghế đã
   * kéo — ghế thuộc `LicenseAssignmentService`, nên hàm này không tự đụng bảng ghế.
   */
  async renew(
    actor: string,
    id: string,
    newEnd: string,
    withinSeats?: (tx: Tx, oldEnd: string | null) => Promise<number>,
    /**
     * Hợp đồng + chi phí của RIÊNG lượt này — vào sổ gia hạn, không vào hồ sơ (Q-15).
     * `websites` (SSL/tên miền): danh sách của kỳ mới; bỏ trống = giữ danh sách đang có.
     */
    terms: { contract?: string | null; cost?: number | null; websites?: string[] } = {},
  ): Promise<SoftwareRecord & { seatsRenewed: number }> {
    const contract = terms.contract?.trim() || null;
    const cost = terms.cost ?? null;
    const nextWebsites =
      terms.websites === undefined ? undefined : requireWebsites(terms.websites);
    // Cùng luật tiền với chi phí ghế: bigint quá 2^53 thì JS đọc ra số khác mà không báo lỗi.
    const termErrors = validateAssignmentTerms({ cost, contract, startDate: null, endDate: null });
    if (termErrors.length > 0) {
      throw new BadRequestException({ code: 'SOFTWARE_INVALID', message: termErrors.join(' ') });
    }
    const before = await this.requireRow(id);
    // Gia hạn đặt lại `status = active`; cho qua ở đây là hồi sinh một hồ sơ người đã chủ ý
    // thanh lý. `requireUnchangedWithin` bên dưới giữ cho ảnh chụp này còn đúng lúc ghi.
    if (before.status === 'retired') {
      throw new ConflictException({
        code: 'SOFTWARE_RETIRED',
        message:
          'Hồ sơ này đã thanh lý nên không gia hạn được. Bấm Khôi phục để dùng lại với hạn mới.',
      });
    }
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
        message: `Hạn mới (${viDate(newEnd)}) phải sau hạn hiện tại (${viDate(before.endDate)}). Sửa nhầm hạn thì dùng Sửa hồ sơ.`,
      });
    }
    return this.db.transaction(async (tx) => {
      // "Hạn mới phải sau hạn hiện tại" và `oldEnd` của sổ gia hạn đều đọc từ `before`. Hai
      // lượt gia hạn cùng lúc thì lượt sau kéo hạn LÙI về và ghi sai hạn cũ vào sổ.
      await this.requireUnchangedWithin(tx, before);
      const hasWebsites = supportsWebsites(before.kind as SoftwareKind);
      const websites = hasWebsites ? (nextWebsites ?? before.websites) : null;
      const siteChange = hasWebsites ? websitesChange(before.websites, nextWebsites) : {};
      const updated = await this.updateWithin(tx, id, {
        endDate: newEnd,
        status: 'active',
        ...('websites' in siteChange ? { websites } : {}),
      });
      // Hợp đồng/chi phí đi kèm dạng bối cảnh (before = after): tab Lịch sử đọc ra "gia hạn tới
      // X · hợp đồng HD-… · chi phí …" mà không giả vờ là hồ sơ có hai trường đó.
      await this.recordWithin(tx, actor, id, 'renewed', {
        endDate: { before: before.endDate, after: newEnd },
        ...(contract !== null ? { contract: { before: contract, after: contract } } : {}),
        ...(cost !== null ? { cost: { before: cost, after: cost } } : {}),
        ...siteChange,
      });
      /*
       * Sổ gia hạn dùng chung ghi Ở ĐÂY, trong chính transaction này (AC 3.4).
       *
       * Nút Gia hạn trong trang hồ sơ gọi thẳng hàm này, không qua `/expiry/renew`. Không ghi
       * `renewal_history` ở đây thì `end_date` đổi, tab Lịch sử có dòng, toast xanh — nhưng
       * báo cáo cuối năm và khối "gia hạn gần đây" đọc `renewal_history` nên trả rỗng.
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
        contract,
        cost,
        // Ảnh chụp danh sách của RIÊNG kỳ này: sửa hồ sơ năm sau không đổi được câu trả lời
        // "năm nay cert này phủ những website nào".
        websites,
      });
      const seatsRenewed = withinSeats ? await withinSeats(tx, before.endDate) : 0;
      return { ...updated, seatsRenewed };
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
   * Số seat đang dùng của cả trang, một lượt đếm.
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
    if (input.websites !== undefined) put('websites', requireWebsites(input.websites));

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
    // thể làm cả hồ sơ thành không hợp lệ.
    //
    // Ghép bằng `effectiveOf` chứ KHÔNG bằng `??`: xoá một ô (giá trị `null` có mặt trong
    // `values`) khác hẳn không đụng tới ô đó, và `??` bóp hai thứ đó thành một. Với `??`,
    // `{"endDate":""}` xoá vĩnh viễn hạn của một chứng chỉ SSL — xem docblock của
    // `common/merge-effective.ts` (A-03).
    const current = id ? await this.requireRow(id) : null;
    const effective = effectiveOf(values);
    const errors = validateSoftware({
      kind: effective<SoftwareKind>('kind', (current?.kind as SoftwareKind) ?? 'other'),
      licenseModel: effective<LicenseModel>(
        'licenseModel',
        (current?.licenseModel as LicenseModel) ?? 'subscription',
      ),
      seatTotal: effective<number | null>('seatTotal', current?.seatTotal ?? null),
      startDate: effective<string | null>('startDate', current?.startDate ?? null),
      endDate: effective<string | null>('endDate', current?.endDate ?? null),
    });
    if (errors.length > 0) {
      throw new BadRequestException({ code: 'SOFTWARE_INVALID', message: errors.join(' ') });
    }

    // Trạng thái do hạn quyết, trừ Thanh lý (DOM-03): sửa ngày hết hạn sang tương lai là tự về
    // Đang dùng; tạo hồ sơ với hạn đã qua là Hết hạn ngay.
    const baseStatus = effective<SoftwareStatus>('status', (current?.status as SoftwareStatus) ?? 'active');
    const today = isoDateInTz(await this.config.getString('appTimezone'));
    const status = effectiveSoftwareStatus(
      baseStatus,
      effective<string | null>('endDate', current?.endDate ?? null),
      today,
    );
    if (current === null || status !== current.status || values.status !== undefined) {
      values.status = status;
    }

    if (values.vendorId) {
      await this.catalog.assertRefs(
        { vendorId: values.vendorId as string },
        current ? { vendorId: current.vendorId } : null,
      );
    }
    return values;
  }

  private requireRow(id: string): Promise<typeof softwareTable.$inferSelect> {
    return this.requireRowWithin(this.db, id);
  }

  private async requireRowWithin(
    tx: Pick<Database, 'select'>,
    id: string,
    lock?: 'update',
  ): Promise<typeof softwareTable.$inferSelect> {
    const query = tx.select().from(softwareTable).where(eq(softwareTable.id, id));
    const rows = await (lock ? query.for(lock) : query);
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SOFTWARE_NOT_FOUND',
        message: 'Không tìm thấy hồ sơ phần mềm này.',
      });
    }
    return rows[0];
  }

  /**
   * Ghế đang gán phải còn hợp với hồ sơ SAU khi sửa — xem `seatConflicts`.
   *
   * Đếm trong `tx`, sau khi hàng `software` đã bị khóa `FOR UPDATE`: lượt gán ghế cũng khóa
   * đúng hàng đó trước khi chèn, nên không ghế nào chen vào giữa lúc đếm và lúc ghi.
   */
  private async requireSeatsFitWithin(
    tx: Tx,
    before: typeof softwareTable.$inferSelect,
    values: Record<string, unknown>,
  ): Promise<void> {
    const rows = await tx
      .select({ used: count(), withEndDate: count(licenseAssignmentTable.endDate) })
      .from(licenseAssignmentTable)
      .where(
        and(
          eq(licenseAssignmentTable.softwareId, before.id),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      );
    const effective = effectiveOf(values);
    const errors = seatConflicts(
      {
        kind: effective<SoftwareKind>('kind', before.kind as SoftwareKind),
        licenseModel: effective<LicenseModel>('licenseModel', before.licenseModel as LicenseModel),
        seatTotal: effective<number | null>('seatTotal', before.seatTotal),
        status: effective<SoftwareStatus>('status', before.status as SoftwareStatus),
      },
      { used: Number(rows[0]?.used ?? 0), withEndDate: Number(rows[0]?.withEndDate ?? 0) },
      before.seatTotal,
    );
    if (errors.length > 0) {
      throw new ConflictException({ code: 'SOFTWARE_SEATS_IN_USE', message: errors.join(' ') });
    }
  }

  /**
   * Thanh lý giải phóng mọi ghế đang gán (QUYET-DINH Q-03), trong cùng transaction với lượt
   * thanh lý; mỗi ghế một dòng lịch sử `license-released` để tab Lịch sử nói được ghế nào rời máy nào.
   */
  private async releaseAllSeatsWithin(tx: Tx, actor: string, softwareId: string): Promise<void> {
    const released = await tx
      .update(licenseAssignmentTable)
      .set({ releasedAt: new Date(), releasedBy: actor })
      .where(
        and(
          eq(licenseAssignmentTable.softwareId, softwareId),
          isNull(licenseAssignmentTable.releasedAt),
        ),
      )
      .returning({ deviceId: licenseAssignmentTable.deviceId });
    for (const row of released) {
      await this.recordWithin(tx, actor, softwareId, 'license-released', {
        deviceId: { before: row.deviceId, after: null },
        reason: { before: null, after: 'thanh lý phần mềm' },
      });
    }
  }

  /** Khóa hàng tới hết transaction và đòi nó còn đúng là hàng `seen` — xem `requireUnchangedSince`. */
  private async requireUnchangedWithin(
    tx: Tx,
    seen: typeof softwareTable.$inferSelect,
  ): Promise<void> {
    const locked = await this.requireRowWithin(tx, seen.id, 'update');
    requireUnchangedSince(seen, locked, {
      code: 'SOFTWARE_ALREADY_CHANGED',
      message: 'Hồ sơ vừa được người khác sửa — tải lại rồi thử lại.',
    });
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

/** Mở ra cho `api/test/sort-index.spec.ts` đọc `EXPLAIN` của ĐÚNG câu này (0058). */
export function softwareOrderBy(sort: SortQuery<SoftwareSortKey>): SQL[] {
  const column = {
    code: softwareTable.code,
    name: softwareTable.name,
    kind: softwareTable.kind,
    seatTotal: softwareTable.seatTotal,
    startDate: softwareTable.startDate,
    endDate: softwareTable.endDate,
    status: softwareTable.status,
  }[sort.key];
  // Xem `orderByStable` — khoá chốt hạ phải đi CÙNG HƯỚNG, nếu không chỉ mục (0058) vô dụng
  // ở đúng một nửa số lượt sắp xếp.
  return orderByStable(sort.dir, column, softwareTable.code);
}

function buildWhere(filter: SoftwareFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const term = filter.search?.trim();
  if (term) {
    // Mã · tên · ghi chú, cả ba trong cột sinh `software.search_norm` (0052) và đã gấp dấu.
    // Tìm phải gấp dấu — B-01.
    // Website của SSL/tên miền không nằm trong `search_norm`: cột sinh không gọi được hàm
    // STABLE như `array_to_string`. Bảng hồ sơ phần mềm cỡ vài trăm dòng — quét tại chỗ được.
    const byText = or(
      searchNormLike(softwareTable, term),
      sql`ims_norm(array_to_string(${softwareTable.websites}, ' ')) LIKE ims_norm(${`%${escapeLike(term)}%`})`,
    ) as SQL;
    parts.push(
      filter.alsoIds && filter.alsoIds.length > 0
        ? or(byText, inArray(softwareTable.id, filter.alsoIds))
        : byText,
    );
  }
  if (filter.kind) parts.push(eq(softwareTable.kind, filter.kind));
  if (filter.licenseModel) parts.push(eq(softwareTable.licenseModel, filter.licenseModel));
  if (filter.status === 'live') {
    parts.push(inArray(softwareTable.status, ['active', 'expired_ok']));
  } else if (filter.status) {
    parts.push(eq(softwareTable.status, filter.status));
  }
  if (filter.vendorId) parts.push(eq(softwareTable.vendorId, filter.vendorId));
  const defined = parts.filter((part): part is SQL => part !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/** Chuẩn hóa danh sách website; sai thì từ chối cả lượt ghi, không lưu một nửa. */
function requireWebsites(list: string[]): string[] {
  const { value, errors } = normalizeWebsites(list);
  if (errors.length > 0) {
    throw new BadRequestException({ code: 'SOFTWARE_INVALID', message: errors.join(' ') });
  }
  return value;
}

/**
 * `diffRecord` không so mảng, nên danh sách website so riêng và ghi vào lịch sử dạng chuỗi nối
 * bằng ", " — tab Lịch sử đọc ra "website: a.vn → a.vn, b.vn" như mọi trường chữ khác.
 */
function websitesChange(before: string[], after: string[] | undefined): RecordChanges {
  if (after === undefined) return {};
  const from = before.join(', ');
  const to = after.join(', ');
  return from === to ? {} : { websites: { before: from || null, after: to || null } };
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

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import { requireUnchangedSince } from '../../common/cas';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { orderByStable, type SortQuery } from '../../common/sorting';
import { conflictOnUnique, escapeLike, searchNormLike } from '../../common/sql';
import { diffRecord, hasChanges } from '../../common/record-diff';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  checkAllowedIps,
  codeFromLogin,
  mergeServiceAccount,
  validateServiceAccount,
  type ServiceAccountKind,
  type ServiceAccountStatus,
} from './service-account-rules';
import { serviceAccountHistoryTable, serviceAccountTable } from './service-account.schema';
import type {
  ServiceAccountFilter,
  ServiceAccountHistoryRecord,
  ServiceAccountInput,
  ServiceAccountRecord,
} from './service-account.types';

/** Trường được theo dõi trong lịch sử (AD-13). */
const TRACKED = [
  'code',
  'kind',
  'name',
  'login',
  'department',
  'ownerName',
  'groupName',
  'allowedIps',
  'note',
  'status',
] as const;

export const SERVICE_ACCOUNT_SORT_KEYS = ['code', 'name', 'kind', 'status'] as const;
export type ServiceAccountSortKey = (typeof SERVICE_ACCOUNT_SORT_KEYS)[number];
export const SERVICE_ACCOUNT_SORT_DEFAULT: SortQuery<ServiceAccountSortKey> = {
  key: 'code',
  dir: 'asc',
};

/**
 * Chủ sở hữu `service_account` + `service_account_history` (AD-3).
 *
 * Module này KHÔNG biết gì về mật khẩu: mật khẩu của một tài khoản dịch vụ nằm trong két sắt
 * với `ownerType: 'service_account'`, y hệt cách `software` không giữ license key.
 */
@Injectable()
export class ServiceAccountService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  async list(
    query: PageQuery,
    filter: ServiceAccountFilter = {},
    sort: SortQuery<ServiceAccountSortKey> = SERVICE_ACCOUNT_SORT_DEFAULT,
  ): Promise<Page<ServiceAccountRecord>> {
    const where = buildWhere(filter);
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(serviceAccountTable)
        .where(where)
        .orderBy(...serviceAccountOrderBy(sort))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(serviceAccountTable).where(where),
    ]);
    return { items: rows.map(toRecord), total: Number(totalRows[0]?.value ?? 0) };
  }

  async findOne(id: string): Promise<ServiceAccountRecord> {
    return toRecord(await this.requireRow(id));
  }

  async exists(id: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: serviceAccountTable.id })
      .from(serviceAccountTable)
      .where(eq(serviceAccountTable.id, id));
    return rows.length > 0;
  }

  async history(id: string): Promise<ServiceAccountHistoryRecord[]> {
    await this.requireRow(id);
    const rows = await this.db
      .select()
      .from(serviceAccountHistoryTable)
      .where(eq(serviceAccountHistoryTable.serviceAccountId, id))
      .orderBy(desc(serviceAccountHistoryTable.createdAt))
      .limit(HISTORY_PAGE_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      serviceAccountId: row.serviceAccountId,
      action: row.action,
      actor: row.actor,
      changes: (row.changes as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    }));
  }

  async create(actor: string, input: ServiceAccountInput): Promise<ServiceAccountRecord> {
    const { values, warnings } = this.prepare(await this.fillBlanks(input));
    try {
      const created = await this.db.transaction(async (tx) => {
        const rows = await tx.insert(serviceAccountTable).values({ ...values, createdBy: actor }).returning();
        await this.recordWithin(tx, actor, rows[0].id, 'created', {
          code: { before: null, after: rows[0].code },
        });
        return rows[0];
      });
      return { ...toRecord(created), warnings };
    } catch (error) {
      throw this.translate(error, values.code);
    }
  }

  async update(
    actor: string,
    id: string,
    input: ServiceAccountInput,
  ): Promise<ServiceAccountRecord> {
    const before = await this.requireRow(id);
    const { values, warnings } = this.prepare(input, before);
    const changes = diffRecord(TRACKED, before, values);
    if (!hasChanges(changes)) return { ...toRecord(before), warnings };

    try {
      const updated = await this.db.transaction(async (tx) => {
        // `values.status` là trạng thái của ảnh chụp ngoài transaction: một lượt vô hiệu hóa
        // commit vào giữa sẽ bị câu UPDATE này mở lại mà không ai ghi lý do.
        requireUnchangedSince(before, await this.requireRowWithin(tx, id, 'update'), {
          code: 'SERVICE_ACCOUNT_ALREADY_CHANGED',
          message: 'Tài khoản này vừa được người khác sửa — tải lại rồi thử lại.',
        });
        const rows = await tx
          .update(serviceAccountTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(serviceAccountTable.id, id))
          .returning();
        await this.recordWithin(tx, actor, id, 'updated', changes);
        return rows[0];
      });
      return { ...toRecord(updated), warnings };
    } catch (error) {
      throw this.translate(error, values.code);
    }
  }

  /**
   * "Xóa" = vô hiệu hóa, đúng quy ước của cả hệ (`device`, `software`, danh mục).
   *
   * Không DELETE thật: mật khẩu của tài khoản này còn nằm trong két, và mọi dòng nhật ký cũ
   * đang trỏ tới id đó. Xóa hẳn là biến chúng thành bản ghi mồ côi.
   */
  async disable(actor: string, id: string, reason: string): Promise<ServiceAccountRecord> {
    return this.switchStatus(actor, id, 'disabled', reason);
  }

  /**
   * Bật lại một tài khoản đã đóng — cũng BẮT ghi lý do, đối xứng với `disable()`.
   *
   * Vì sao không để `PATCH {status:'active'}` làm việc này: mở lại một tài khoản dùng chung
   * đã bị đóng là một quyết định, không phải một lần sửa ô. "Ai mở lại, ngày nào, vì sao" là
   * đúng bộ câu hỏi mà `disable()` sinh ra để trả lời — bỏ nửa sau thì nửa đầu cũng vô dụng.
   */
  async enable(actor: string, id: string, reason: string): Promise<ServiceAccountRecord> {
    return this.switchStatus(actor, id, 'active', reason);
  }

  private async switchStatus(
    actor: string,
    id: string,
    next: ServiceAccountStatus,
    reason: string,
  ): Promise<ServiceAccountRecord> {
    if (!reason.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message:
          next === 'disabled'
            ? 'Ghi lý do vô hiệu hóa — sáu tháng sau sẽ có người hỏi vì sao.'
            : 'Ghi lý do bật lại — sáu tháng sau sẽ có người hỏi vì sao.',
      });
    }
    const action = next === 'disabled' ? 'disabled' : 'enabled';
    const updated = await this.db.transaction(async (tx) => {
      /*
       * Đọc trạng thái SAU khi khóa hàng, trong cùng transaction với câu ghi: hai lượt bấm
       * cùng lúc thì lượt sau phải thấy trạng thái lượt trước vừa ghi.
       *
       * Đóng một tài khoản đã đóng (hoặc mở một tài khoản đang mở) KHÔNG được ghi gì — không
       * chặn thì lịch sử có hai dòng "Vô hiệu hóa" với "Đã vô hiệu → Đã vô hiệu", và người đọc
       * phải dừng lại tìm xem lần nào mới là lần thật.
       */
      const before = await this.requireRowWithin(tx, id, 'update');
      if (before.status === next) {
        throw new BadRequestException({
          code: 'STATUS_UNCHANGED',
          message:
            next === 'disabled'
              ? 'Tài khoản này đã bị vô hiệu hóa từ trước.'
              : 'Tài khoản này đang dùng bình thường.',
        });
      }
      const rows = await tx
        .update(serviceAccountTable)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(serviceAccountTable.id, id))
        .returning();
      await this.recordWithin(tx, actor, id, action, {
        status: { before: before.status, after: next },
        reason: { before: null, after: reason.trim() },
      });
      return rows[0];
    });
    return toRecord(updated);
  }

  /**
   * Lấp MÃ và TÊN khi người khai để trống — chỉ lúc TẠO MỚI.
   *
   * Người ta biết tài khoản đăng nhập bằng gì; "mã" và "tên gọi" là thứ hệ thống cần chứ họ
   * không cần, và bắt gõ là bắt bịa. Mã suy từ tên đăng nhập, tên thì lấy luôn tên đăng nhập.
   *
   * Mã trùng thì thêm `-2`, `-3`… Hai tài khoản khác nhau vẫn có thể cùng tên đăng nhập ở hai
   * hệ thống khác nhau (`admin` trên Draytek và `admin` trên NAS), nên đây không phải trường
   * hợp hiếm — và để nó nổ 409 với một cái mã người dùng chưa từng gõ là vô lý.
   *
   * Vòng lặp là "thử rồi kiểm", không phải khóa: hai request cùng lúc vẫn có thể cùng chọn
   * `ADMIN-2`. Ràng buộc duy nhất của DB vẫn là hàng rào cuối và `translate()` vẫn dịch nó
   * thành 409 tử tế — nhưng đó là cửa hẹp hơn nhiều so với "mọi lần khai `admin` thứ hai".
   */
  private async fillBlanks(input: ServiceAccountInput): Promise<ServiceAccountInput> {
    const login = (input.login ?? '').trim();
    const code = input.code?.trim();
    const name = input.name?.trim();
    if (code && name) return input;
    /*
     * Không có gì để suy ra thì TRẢ NGUYÊN, để `validateServiceAccount` báo đúng ô còn thiếu.
     * Tự bịa ra một cái mã cho một hồ sơ trống trơn là tạo ra rác không ai truy được.
     */
    if (!login && (!code || !name)) return input;

    let nextCode = code;
    if (!nextCode) {
      const base = codeFromLogin(login);
      const taken = new Set(
        (
          await this.db
            .select({ code: serviceAccountTable.code })
            .from(serviceAccountTable)
            .where(ilike(serviceAccountTable.code, `${escapeLike(base)}%`))
        ).map((row) => row.code.toUpperCase()),
      );
      nextCode = base;
      for (let n = 2; taken.has(nextCode.toUpperCase()); n += 1) nextCode = `${base}-${n}`;
    }
    return { ...input, code: nextCode, name: name || login };
  }

  /** Chuẩn hóa + kiểm luật thuần. Lỗi thì 400 kèm ĐỦ chỗ sai, không chỉ chỗ đầu tiên. */
  private prepare(
    input: ServiceAccountInput,
    /** Bản ghi đang có — chỉ có khi SỬA. Dùng để giữ nguyên ô không được gửi lên. */
    before?: typeof serviceAccountTable.$inferSelect,
  ) {
    const kind = input.kind;
    const vpn = kind === 'vpn';
    /*
     * Ghép body với dòng đang có TRƯỚC, rồi mới kiểm — luật ghép và lý do nằm ở
     * `mergeServiceAccount` (hàm thuần, có test bảng dữ liệu riêng).
     *
     * Điều quan trọng ở đây: `validateServiceAccount` chạy trên bản ĐÃ GHÉP, tức là đúng giá
     * trị sẽ nằm trong DB — không phải trên body. Kiểm trên body thì một `PATCH {code, kind,
     * name}` lên tài khoản VPN đang để `allowedIps = '0.0.0.0/0'` trả về `warnings: []`.
     */
    const merged = mergeServiceAccount(input, before);
    const check = validateServiceAccount(merged);
    if (check.errors.length > 0) {
      throw new BadRequestException({
        code: 'SERVICE_ACCOUNT_INVALID',
        message: check.errors.join(' '),
      });
    }

    return {
      values: {
        code: merged.code.trim(),
        kind,
        name: merged.name.trim(),
        login: merged.login,
        department: merged.department,
        ownerName: merged.ownerName,
        // Ô của loại khác đã bị `validateServiceAccount` chặn; ở đây ép null cho chắc, để
        // đổi loại từ VPN sang dùng chung không để lại vết của loại cũ.
        groupName: vpn ? merged.groupName : null,
        /*
         * Lưu bản ĐÃ CHUẨN HÓA: `checkAllowedIps` vốn đã bỏ khoảng trắng thừa, bỏ mục rỗng
         * và bỏ mục trùng — nhưng bản trước lưu nguyên chuỗi thô, nên "1.2.3.4, , 1.2.3.4"
         * nằm y nguyên trong DB và đi vòng qua form vẫn thế. Dựng ra một hàm chuẩn hóa rồi
         * không ai đọc thì nó chỉ là một lời hứa trong test.
         */
        allowedIps: vpn ? normalizeIps(merged.allowedIps) : null,
        note: merged.note,
        /*
         * Trạng thái KHÔNG đọc từ body — `ServiceAccountInput` không còn ô đó.
         *
         * Sửa hồ sơ thì giữ nguyên trạng thái đang có; tạo mới thì 'active'. Đổi trạng thái
         * là việc của `disable()`/`enable()`, hai đường bắt ghi lý do. Bản trước còn nhận
         * `input.status`, tức là `PATCH {status:'active'}` âm thầm bật lại một tài khoản vừa
         * bị đóng, xoá công của `disable()` và cái lý do nó đã ghi, mà lịch sử chỉ nói "updated".
         */
        status: before?.status ?? 'active',
      },
      warnings: check.warnings,
    };
  }

  private translate(error: unknown, code: string): unknown {
    return conflictOnUnique(error, {
      code: 'SERVICE_ACCOUNT_CODE_TAKEN',
      message: `Mã "${code}" đã thuộc về một tài khoản dịch vụ khác.`,
    });
  }

  private async recordWithin(
    tx: Tx,
    actor: string,
    id: string,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(serviceAccountHistoryTable).values({
      serviceAccountId: id,
      action,
      actor,
      changes,
    });
    await this.audit.appendWithin(tx, {
      actor,
      action: `service_account.${action}`,
      objectType: 'service_account',
      objectId: id,
      detail: { changes },
    });
  }

  private requireRow(id: string): Promise<typeof serviceAccountTable.$inferSelect> {
    return this.requireRowWithin(this.db, id);
  }

  private async requireRowWithin(
    tx: Pick<Database, 'select'>,
    id: string,
    lock?: 'update',
  ): Promise<typeof serviceAccountTable.$inferSelect> {
    const query = tx.select().from(serviceAccountTable).where(eq(serviceAccountTable.id, id));
    const rows = await (lock ? query.for(lock) : query);
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'SERVICE_ACCOUNT_NOT_FOUND',
        message: 'Không tìm thấy tài khoản dịch vụ này.',
      });
    }
    return rows[0];
  }
}

/** Chuẩn hóa danh sách IP được phép; giữ `null` nguyên là `null`. */
function normalizeIps(value: string | null): string | null {
  if (value === null) return null;
  const normalized = checkAllowedIps(value).normalized;
  return normalized.length === 0 ? null : normalized.join(', ');
}

function buildWhere(filter: ServiceAccountFilter): SQL | undefined {
  const parts: SQL[] = [];
  const term = filter.search?.trim();
  if (term) {
    // Mã · tên · tên đăng nhập · phòng ban · người phụ trách — cả năm nằm trong cột sinh
    // `service_account.search_norm` (0052) và đã gấp dấu. Năm vế `ilike()` trước đây không
    // gấp dấu, nên gõ "ke toan" không ra "Kế toán" — B-01.
    parts.push(searchNormLike(serviceAccountTable, term));
  }
  if (filter.kind) parts.push(eq(serviceAccountTable.kind, filter.kind));
  if (filter.status) parts.push(eq(serviceAccountTable.status, filter.status));
  return parts.length === 0 ? undefined : and(...parts);
}

/**
 * Mở ra cho `api/test/sort-index.spec.ts` đọc `EXPLAIN` của ĐÚNG câu này (0058).
 *
 * Đổi tên từ `orderBy` sang `serviceAccountOrderBy`: ba service kia đã mang tiền tố module,
 * và một hàm tên `orderBy` xuất khẩu ra khỏi file thì nơi gọi không biết nó sắp bảng nào.
 */
export function serviceAccountOrderBy(sort: SortQuery<ServiceAccountSortKey>): SQL[] {
  const column = {
    code: serviceAccountTable.code,
    name: serviceAccountTable.name,
    kind: serviceAccountTable.kind,
    status: serviceAccountTable.status,
  }[sort.key];
  // Xem `orderByStable`. Bản trước ở đây còn thiếu cả cái chốt `sort.key === 'code'` mà ba
  // service kia có, nên sắp theo mã giảm dần sinh ra `ORDER BY code DESC, code ASC`.
  return orderByStable(sort.dir, column, serviceAccountTable.code);
}

function toRecord(row: typeof serviceAccountTable.$inferSelect): ServiceAccountRecord {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as ServiceAccountKind,
    name: row.name,
    login: row.login,
    department: row.department,
    ownerName: row.ownerName,
    groupName: row.groupName,
    allowedIps: row.allowedIps,
    note: row.note,
    status: row.status as ServiceAccountRecord['status'],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

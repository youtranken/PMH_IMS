import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import type { SortQuery } from '../../common/sorting';
import { escapeLike, pgErrorCode, PG_UNIQUE_VIOLATION } from '../../common/sql';
import { diffRecord, hasChanges } from '../../common/record-diff';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  checkAllowedIps,
  validateServiceAccount,
  type ServiceAccountKind,
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
        .orderBy(...orderBy(sort))
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
      .orderBy(desc(serviceAccountHistoryTable.createdAt));
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
    const { values, warnings } = this.prepare(input);
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
    const before = await this.requireRow(id);
    if (!reason.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Ghi lý do vô hiệu hóa — sáu tháng sau sẽ có người hỏi vì sao.',
      });
    }
    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(serviceAccountTable)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(eq(serviceAccountTable.id, id))
        .returning();
      await this.recordWithin(tx, actor, id, 'disabled', {
        status: { before: before.status, after: 'disabled' },
        reason: { before: null, after: reason.trim() },
      });
      return rows[0];
    });
    return toRecord(updated);
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
     * THIẾU một ô nghĩa là "đừng đụng tới", KHÔNG phải "xoá đi".
     *
     * Mọi ô trong `ServiceAccountBodyDto` đều `@IsOptional()`, nên một `PATCH {code, kind,
     * name}` — đúng bộ tối thiểu mà DTO cho phép — sẽ ghi `null` đè lên login, bộ phận,
     * người phụ trách, nhóm VPN, dải IP và ghi chú; rồi ghi vào lịch sử như một lần sửa bình
     * thường. Form hiện tại luôn gửi đủ ô nên chỗ này chỉ cắn người gọi API, và cắn im lặng.
     *
     * `keep` chỉ áp khi SỬA (`before` có giá trị). Lúc TẠO thì thiếu ô đúng là để trống.
     */
    const keep = <K extends 'login' | 'department' | 'ownerName' | 'groupName' | 'allowedIps' | 'note'>(
      key: K,
      raw: string | undefined,
    ): string | null => (raw === undefined ? (before?.[key] ?? null) : blank(raw));

    /*
     * Kiểm trên GIÁ TRỊ SẼ NẰM TRONG DB, không phải trên body.
     *
     * Bản trước gọi `validateServiceAccount(input)` ngay đầu hàm, tức là TRƯỚC khi `keep`
     * lấp các ô bị bỏ trống bằng giá trị cũ. Nên một `PATCH {code, kind, name}` lên tài khoản
     * VPN đang để `allowedIps = '0.0.0.0/0'` chạy qua với `allowedIps: undefined` — không
     * lỗi, và quan trọng hơn là KHÔNG cảnh báo, trong khi dòng vừa ghi vẫn mở toang cho cả
     * internet. Cảnh báo trả về rỗng đọc thành "kiểm rồi, sạch".
     */
    const effective = {
      code: input.code,
      kind,
      name: input.name,
      login: keep('login', input.login) ?? undefined,
      department: keep('department', input.department) ?? undefined,
      ownerName: keep('ownerName', input.ownerName) ?? undefined,
      groupName: vpn ? (keep('groupName', input.groupName) ?? undefined) : input.groupName,
      allowedIps: vpn ? (keep('allowedIps', input.allowedIps) ?? undefined) : input.allowedIps,
    };
    const check = validateServiceAccount(effective);
    if (check.errors.length > 0) {
      throw new BadRequestException({
        code: 'SERVICE_ACCOUNT_INVALID',
        message: check.errors.join(' '),
      });
    }

    return {
      values: {
        code: input.code.trim(),
        kind,
        name: input.name.trim(),
        login: keep('login', input.login),
        department: keep('department', input.department),
        ownerName: keep('ownerName', input.ownerName),
        // Ô của loại khác đã bị `validateServiceAccount` chặn; ở đây ép null cho chắc, để
        // đổi loại từ VPN sang dùng chung không để lại vết của loại cũ.
        groupName: vpn ? keep('groupName', input.groupName) : null,
        /*
         * Lưu bản ĐÃ CHUẨN HÓA: `checkAllowedIps` vốn đã bỏ khoảng trắng thừa, bỏ mục rỗng
         * và bỏ mục trùng — nhưng bản trước lưu nguyên chuỗi thô, nên "1.2.3.4, , 1.2.3.4"
         * nằm y nguyên trong DB và đi vòng qua form vẫn thế. Dựng ra một hàm chuẩn hóa rồi
         * không ai đọc thì nó chỉ là một lời hứa trong test.
         */
        allowedIps: vpn ? normalizeIps(keep('allowedIps', input.allowedIps)) : null,
        note: keep('note', input.note),
        /*
         * KHÔNG mặc định 'active' khi sửa: cùng lý do như trên — `PATCH` thiếu `status` sẽ
         * âm thầm bật lại một tài khoản vừa bị vô hiệu hóa, xoá công của `disable()` và cái
         * lý do nó đã ghi, mà dòng lịch sử chỉ nói "updated".
         */
        status: input.status ?? before?.status ?? 'active',
      },
      warnings: check.warnings,
    };
  }

  private translate(error: unknown, code: string): unknown {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException({
        code: 'SERVICE_ACCOUNT_CODE_TAKEN',
        message: `Mã "${code}" đã thuộc về một tài khoản dịch vụ khác.`,
      });
    }
    return error;
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

  private async requireRow(id: string): Promise<typeof serviceAccountTable.$inferSelect> {
    const rows = await this.db
      .select()
      .from(serviceAccountTable)
      .where(eq(serviceAccountTable.id, id));
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

function blank(value?: string | null): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

function buildWhere(filter: ServiceAccountFilter): SQL | undefined {
  const parts: SQL[] = [];
  const term = filter.search?.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    const search = or(
      ilike(serviceAccountTable.code, like),
      ilike(serviceAccountTable.name, like),
      ilike(serviceAccountTable.login, like),
      ilike(serviceAccountTable.department, like),
      ilike(serviceAccountTable.ownerName, like),
    );
    if (search) parts.push(search);
  }
  if (filter.kind) parts.push(eq(serviceAccountTable.kind, filter.kind));
  if (filter.status) parts.push(eq(serviceAccountTable.status, filter.status));
  return parts.length === 0 ? undefined : and(...parts);
}

function orderBy(sort: SortQuery<ServiceAccountSortKey>): SQL[] {
  const column = {
    code: serviceAccountTable.code,
    name: serviceAccountTable.name,
    kind: serviceAccountTable.kind,
    status: serviceAccountTable.status,
  }[sort.key];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Khóa phụ cố định: hai dòng cùng giá trị cột đang sắp thì thứ tự phải ỔN ĐỊNH giữa các
  // trang, không thì sang trang 2 có dòng lặp lại và có dòng biến mất.
  return [primary, asc(serviceAccountTable.code)];
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

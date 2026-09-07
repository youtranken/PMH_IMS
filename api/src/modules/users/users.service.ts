import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import type { Page, PageQuery } from '../../common/pagination';
import { pageOffset } from '../../common/pagination';
import type { SealedValue } from '../../common/crypto/envelope.types';
import type { SortQuery } from '../../common/sorting';
import { registerFailure, type LockoutPolicy, type LockoutState } from '../../common/lockout';
import type { UserRole } from '../auth/types';
import { usersTable } from './users.schema';
import type { UserCredentials, UserRecord } from './users.types';

/**
 * Chủ sở hữu bảng `users` (AD-3). Module khác KHÔNG query bảng này — đi qua UsersApiService.
 * Mọi hàm ghi nhận `tx` tường minh (AD-5).
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(usersTable).where(eq(usersTable.email, email));
    return rows[0] ? toCredentials(rows[0]) : null;
  }

  async findCredentialsById(id: string): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    return rows[0] ? toCredentials(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const found = await this.findCredentialsById(id);
    return found ? strip(found) : null;
  }

  /**
   * Danh sách có tìm kiếm PHÍA SERVER: lọc phía client chỉ lọc đúng trang đang xem,
   * nên gõ tên nằm ở trang 3 sẽ ra bảng rỗng trong khi tổng số vẫn báo 137 dòng.
   *
   * Sắp xếp cũng PHÍA SERVER (AD-15, cùng cửa `parseSortQuery`): lý do y hệt — sắp ở client
   * chỉ đảo chỗ 20 dòng đang xem, không phải cả bảng người dùng.
   */
  async list(
    query: PageQuery,
    search?: string,
    sort: SortQuery<UserSortKey> = USER_SORT_DEFAULT,
  ): Promise<Page<UserRecord>> {
    const term = search?.trim();
    const where = term
      ? or(
          ilike(usersTable.fullName, `%${term}%`),
          sql`${usersTable.email}::text ILIKE ${`%${term}%`}`,
          // Tra theo SĐT và mã nhân viên: Nhân sự đưa sang một danh sách mã, người trực gõ
          // một số điện thoại — cả hai đều là cách tìm THẬT, không phải chỉ tìm theo tên.
          ilike(usersTable.phone, `%${term}%`),
          ilike(usersTable.employeeCode, `%${term}%`),
        )
      : undefined;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(usersTable)
        .where(where)
        .orderBy(...userOrderBy(sort))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(usersTable).where(where),
    ]);
    return {
      items: rows.map((r) => strip(toCredentials(r))),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /**
   * Đếm SA đang hoạt động BÊN TRONG `tx`, và KHÓA từng hàng đếm được (AD-5).
   *
   * Chặn hạ/khóa SA cuối cùng (NFR-01 "luôn còn 2 SA", dual control).
   *
   * Vì sao phải khóa chứ không chỉ đếm lại trong tx: hai lệnh khóa tài khoản chạy song song
   * trên hai SA khác nhau đều đọc "còn 2 SA hoạt động", cả hai qua cửa, cả hai khóa — hệ
   * thống còn 0 SA và không ai vào được nữa. `FOR UPDATE` bắt lượt thứ hai xếp hàng; khi nó
   * chạy tiếp, hàng của người vừa bị khóa đã đổi `status` nên không còn khớp `active` và
   * phép đếm ra đúng con số thật.
   *
   * Khóa TẤT CẢ SA đang hoạt động, KỂ CẢ hàng sắp bị đổi, rồi mới loại nó ra lúc đếm —
   * chứ không loại nó ra ngay trong câu `WHERE`.
   *
   * Đây là điểm mấu chốt, và bản viết đầu của chính hàm này đã sai ở đây. Nếu mỗi transaction
   * chỉ khóa các SA KHÁC rồi UPDATE hàng đích của mình, hai lượt khóa song song ôm chéo nhau:
   * T1 giữ B rồi đòi A, T2 giữ A rồi đòi B → Postgres bắn deadlock 40P01, người dùng nhận 500
   * thay vì câu tiếng Việt giải thích còn bao nhiêu SA. Đã tái hiện thật bằng
   * `e2e/tests/m2-concurrency.spec.ts` trước khi sửa lại.
   *
   * Khóa cả tập theo `ORDER BY id` thì mọi lượt gọi lấy khóa theo CÙNG một thứ tự và
   * không bao giờ có vòng chờ. Lượt thứ hai xếp hàng, và khi tới lượt nó thì hàng vừa bị
   * khóa đã đổi `status` nên không còn khớp `active` — phép đếm ra đúng con số thật.
   *
   * Dùng `select` rồi đếm trong JS chứ không `count()`: Postgres không cho `FOR UPDATE` đi
   * cùng hàm tổng hợp.
   */
  async countActiveSaWithin(tx: Tx, exceptUserId?: string): Promise<number> {
    const rows = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, 'sa'), eq(usersTable.status, 'active')))
      .orderBy(usersTable.id)
      .for('update');
    return rows.filter((row) => row.id !== exceptUserId).length;
  }

  async createWithin(
    tx: Tx,
    input: {
      email: string;
      fullName: string;
      phone?: string | null;
      employeeCode?: string | null;
      birthDate?: string | null;
      role: UserRole;
      passwordHash: string;
      totpLoginRequired: boolean;
    },
  ): Promise<UserRecord> {
    const rows = await tx
      .insert(usersTable)
      .values({ ...input, mustChangePassword: true })
      .returning();
    return strip(toCredentials(rows[0]));
  }

  /** Sửa hồ sơ (0031). Email KHÔNG nằm ở đây — xem chú thích ở `accounts.service.ts`. */
  async updateProfileWithin(
    tx: Tx,
    userId: string,
    values: {
      fullName: string;
      phone: string | null;
      employeeCode: string | null;
      birthDate: string | null;
    },
  ): Promise<UserRecord> {
    const rows = await tx
      .update(usersTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
    return strip(toCredentials(rows[0]));
  }

  async setPasswordWithin(
    tx: Tx,
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await tx
      .update(usersTable)
      .set({ passwordHash, mustChangePassword, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async setStatusWithin(
    tx: Tx,
    userId: string,
    status: 'active' | 'locked' | 'disabled',
  ): Promise<void> {
    await tx
      .update(usersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async setTotpLoginRequiredWithin(tx: Tx, userId: string, required: boolean): Promise<void> {
    await tx
      .update(usersTable)
      .set({ totpLoginRequired: required, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  /** Lưu TOTP secret đã envelope (AD-4) — không bao giờ lưu plaintext. */
  async setTotpSecretWithin(tx: Tx, userId: string, sealed: SealedValue): Promise<void> {
    await tx
      .update(usersTable)
      .set({
        totpSecretCt: sealed.ciphertext,
        totpSecretIv: sealed.iv,
        totpSecretTag: sealed.tag,
        totpDekWrapped: sealed.wrappedDek,
        totpKeyVersion: sealed.keyVersion,
        totpEnrolledAt: null,
        totpLastTimestep: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  }

  async markTotpEnrolledWithin(tx: Tx, userId: string, timeStep: number): Promise<void> {
    await tx
      .update(usersTable)
      .set({ totpEnrolledAt: new Date(), totpLastTimestep: timeStep, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  /** Chống replay (NFR-01): ghi lại time step vừa dùng. */
  async setTotpLastTimestep(userId: string, timeStep: number): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ totpLastTimestep: timeStep })
      .where(eq(usersTable.id, userId));
  }

  async clearTotpWithin(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(usersTable)
      .set({
        totpSecretCt: null,
        totpSecretIv: null,
        totpSecretTag: null,
        totpDekWrapped: null,
        totpKeyVersion: null,
        totpEnrolledAt: null,
        totpLastTimestep: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  }

  /**
   * Cộng MỘT vào bộ đếm sai mật khẩu và khóa tài khoản nếu chạm ngưỡng — NGUYÊN TỬ, trong `tx`.
   *
   * VÌ SAO KHÔNG CÒN `applyLockoutState` GHI GIÁ TRỊ TUYỆT ĐỐI. Bản cũ đọc `failed_attempts`
   * ở đầu `login()`, rồi Argon2 xác minh mất ~200ms, rồi mới ghi đè một con số tính sẵn. Bắn
   * nhiều request song song cùng email: tất cả đọc được cùng con số cũ, tất cả tính ra cùng
   * giá trị mới, tất cả ghi đè nhau — **N lần đoán chỉ tốn 1 lượt đếm**, và hàng rào "sai 5
   * lần thì khóa" của NFR-01 gần như vô hiệu. Đã tái hiện thật: 6 lượt sai đồng thời cho ra
   * `failed_attempts = 1` (`e2e/tests/auth-hardening.spec.ts`).
   *
   * Cả phép cộng và phép quyết định khóa nằm trong MỘT câu UPDATE, nên hai request song song
   * buộc phải xếp hàng ở hàng đó và mỗi lượt đếm đúng một lần. Repo đã làm đúng lối này ở
   * `session.service.ts` (`SET stepup_failures = stepup_failures + 1`); đường login là chỗ sót.
   *
   * KHÔNG viết lại luật bằng SQL. `SELECT ... FOR UPDATE` khóa đúng hàng người dùng đó, nên
   * lượt song song thứ hai phải xếp hàng và khi tới lượt nó ĐỌC LẠI giá trị đã commit rồi mới
   * tính. Nhờ vậy `registerFailure` trong `lockout.ts` vẫn là NGUỒN DUY NHẤT của luật (ngưỡng
   * khóa, "khóa hết hạn thì đếm lại từ 0", gia hạn khóa), và `lockout.spec.ts` vẫn là nơi chốt
   * nó bằng 9 test bảng dữ liệu. Dịch luật đó sang một biểu thức CASE trong SQL là đẻ ra bản
   * thứ hai của cùng một luật — đúng mẫu M5 mà hai đợt rà soát đều cảnh báo.
   *
   * Argon2 (~200ms) chạy TRƯỚC transaction này, nên khóa hàng chỉ giữ trong một tx rất ngắn.
   */
  async registerLoginFailureWithin(
    tx: Tx,
    userId: string,
    policy: LockoutPolicy,
    now: Date,
  ): Promise<LockoutState & { justLocked: boolean }> {
    const current = await tx
      .select({
        failedAttempts: usersTable.failedAttempts,
        lockedUntil: usersTable.lockedUntil,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for('update');

    if (current.length === 0) {
      return { failedAttempts: 0, lockedUntil: null, justLocked: false };
    }

    const next = registerFailure(current[0], policy, now);
    await tx
      .update(usersTable)
      .set({
        failedAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId));
    return next;
  }

  async markLoginSuccess(userId: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async listRecipients(roles: UserRole[]): Promise<{ email: string; fullName: string }[]> {
    const rows = await this.db
      .select({ email: usersTable.email, fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.status, 'active'));
    return rows
      .filter((r) => roles.includes(r.role as UserRole))
      .map((r) => ({ email: r.email, fullName: r.fullName }));
  }
}

/**
 * Cột được phép sắp xếp. Đây là WHITELIST — tên cột đi thẳng vào `ORDER BY`.
 *
 * Chỉ mở những cột nằm SẴN trong bảng `users` (AD-2). `email` không có mặt: nó chỉ hiện
 * dưới dạng dòng phụ trong ô Họ tên, không phải cột riêng — không có nút bấm nào gửi nó lên.
 */
export const USER_SORT_KEYS = [
  'fullName',
  'role',
  'status',
  'totpEnrolledAt',
  'lastLoginAt',
] as const;
export type UserSortKey = (typeof USER_SORT_KEYS)[number];
export const USER_SORT_DEFAULT: SortQuery<UserSortKey> = { key: 'fullName', dir: 'asc' };

function userOrderBy(sort: SortQuery<UserSortKey>): SQL[] {
  const column = {
    fullName: usersTable.fullName,
    role: usersTable.role,
    status: usersTable.status,
    totpEnrolledAt: usersTable.totpEnrolledAt,
    lastLoginAt: usersTable.lastLoginAt,
  }[sort.key];
  const primary = sort.dir === 'desc' ? desc(column) : asc(column);
  // Chốt hạ bằng `email` (duy nhất, UNIQUE ở migration 0002): không cột nào trong whitelist ở
  // trên là duy nhất, thiếu chốt hạ thì hai người cùng vai/trạng thái có thể đổi chỗ nhau giữa
  // hai lần tải — sang trang 2 lại thấy đúng người vừa xem ở trang 1, hoặc mất hẳn một dòng.
  return [primary, asc(usersTable.email)];
}

type Row = typeof usersTable.$inferSelect;

function toCredentials(row: Row): UserCredentials {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone ?? null,
    employeeCode: row.employeeCode ?? null,
    birthDate: row.birthDate ?? null,
    role: row.role as UserRole,
    status: row.status as UserCredentials['status'],
    mustChangePassword: row.mustChangePassword,
    totpEnrolledAt: row.totpEnrolledAt,
    totpLoginRequired: row.totpLoginRequired,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    passwordHash: row.passwordHash,
    totpSecretCt: row.totpSecretCt ?? null,
    totpSecretIv: row.totpSecretIv ?? null,
    totpSecretTag: row.totpSecretTag ?? null,
    totpDekWrapped: row.totpDekWrapped ?? null,
    totpKeyVersion: row.totpKeyVersion ?? null,
    totpLastTimestep: row.totpLastTimestep ?? null,
  };
}

/**
 * Bóc mọi trường bí mật trước khi bản ghi rời module (AD-4): controller/UI không bao giờ
 * nhìn thấy password_hash hay TOTP secret, kể cả dạng ciphertext.
 */
function strip(user: UserCredentials): UserRecord {
  const rest: Record<string, unknown> = { ...user };
  for (const key of [
    'passwordHash',
    'totpSecretCt',
    'totpSecretIv',
    'totpSecretTag',
    'totpDekWrapped',
    'totpKeyVersion',
    'totpLastTimestep',
  ]) {
    delete rest[key];
  }
  return rest as unknown as UserRecord;
}

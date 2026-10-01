import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import type { Page, PageQuery } from '../../common/pagination';
import { pageOffset } from '../../common/pagination';
import type { SealedValue } from '../../common/crypto/envelope.types';
import type { SortQuery } from '../../common/sorting';
import { imsNormLike } from '../../common/sql';
import {
  registerAccountFailure,
  type BackoffPolicy,
  type LockoutState,
} from '../../common/lockout';
import type { UserRole } from '../auth/types';
import { usersTable } from './users.schema';
import type { UserCredentials, UserDirectoryEntry, UserRecord } from './users.types';

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
    filters: UserListFilters = {},
  ): Promise<Page<UserRecord>> {
    const term = search?.trim();
    /*
     * Gấp dấu TÍNH TẠI CHỖ (B-01) — `imsNormLike`, không cột sinh.
     *
     * Bảng này là nhân sự IT nội bộ, luôn dưới vài trăm dòng, nên nó cố ý đứng ngoài bộ cột
     * sinh + chỉ mục GIN của các bảng nghiệp vụ. Nhưng "không cần chỉ mục" và "không cần gấp dấu"
     * là HAI chuyện khác nhau: `full_name` là họ tên tiếng Việt, tức đúng chỗ dấu làm hỏng việc
     * tìm nhất. Để nguyên `ILIKE` thì gõ `nguyen thi` ở màn Tài khoản ra bảng rỗng, trong khi
     * sáu màn kia tìm được.
     *
     * Giá phải trả: một lượt quét tuần tự có gọi hàm. Ở vài trăm dòng thì đó không phải giá.
     */
    const where = and(
      term
        ? or(
            imsNormLike(usersTable.fullName, term),
            imsNormLike(usersTable.email, term),
            // Tra theo SĐT và mã nhân viên: Nhân sự đưa sang một danh sách mã, người trực gõ
            // một số điện thoại — cả hai đều là cách tìm THẬT, không phải chỉ tìm theo tên.
            imsNormLike(usersTable.phone, term),
            imsNormLike(usersTable.employeeCode, term),
          )
        : undefined,
      filters.role ? eq(usersTable.role, filters.role) : undefined,
      filters.status ? eq(usersTable.status, filters.status) : undefined,
      filters.totp === 'none' ? isNull(usersTable.totpEnrolledAt) : undefined,
      filters.totp === 'enrolled' ? isNotNull(usersTable.totpEnrolledAt) : undefined,
    );
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
      tempPasswordExpiresAt: Date;
    },
  ): Promise<UserRecord> {
    const rows = await tx
      .insert(usersTable)
      .values({ ...input, mustChangePassword: true })
      .returning();
    return strip(toCredentials(rows[0]));
  }

  /** Sửa hồ sơ. Email KHÔNG nằm ở đây — xem chú thích ở `accounts.service.ts`. */
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

  /**
   * `tempExpiresAt` có giá trị = SA cấp mật khẩu tạm (buộc đổi, có hạn); `null` = người dùng tự
   * đặt (hết buộc đổi, xoá hạn). Một tham số cho cả hai cờ để không bao giờ có hàng "buộc đổi"
   * mà quên mốc hạn, hay "đã tự đặt" mà còn sót mốc.
   */
  async setPasswordWithin(
    tx: Tx,
    userId: string,
    passwordHash: string,
    tempExpiresAt: Date | null,
  ): Promise<void> {
    await tx
      .update(usersTable)
      .set({
        passwordHash,
        mustChangePassword: tempExpiresAt !== null,
        tempPasswordExpiresAt: tempExpiresAt,
        updatedAt: new Date(),
      })
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

  async setRoleWithin(tx: Tx, userId: string, role: UserRole): Promise<void> {
    await tx
      .update(usersTable)
      .set({ role, updatedAt: new Date() })
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

  /**
   * Đóng dấu đã enroll VÀ đốt mã xác nhận trong cùng một câu.
   *
   * Trả về `false` khi tài khoản đã enroll rồi — vị từ `totp_enrolled_at IS NULL` là thứ loại
   * trừ hai lượt xác nhận chồng nhau. Kiểm ở service (`confirmTotpEnrollment`) chạy NGOÀI
   * transaction nên một mình nó không loại trừ được gì; hai lượt cùng lọt qua thì lượt sau
   * ghi đè `totp_enrolled_at` và mốc chống replay của lượt trước.
   */
  async markTotpEnrolledWithin(tx: Tx, userId: string, timeStep: number): Promise<boolean> {
    const rows = await tx
      .update(usersTable)
      .set({ totpEnrolledAt: new Date(), totpLastTimestep: timeStep, updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId), isNull(usersTable.totpEnrolledAt)))
      .returning({ id: usersTable.id });
    return rows.length === 1;
  }

  /**
   * Chống replay (NFR-01): ghi lại time step vừa dùng — LUÔN trong transaction đang chạy.
   *
   * ===== VÌ SAO KHÔNG CÓ BẢN CHẠY-TRÊN-POOL =====
   *
   * Một bản `setTotpLastTimestep(userId, timeStep)` chạy thẳng trên `this.db` thì nơi gọi sẽ
   * gọi nó SAU KHI transaction cấp phiên / đóng dấu step-up đã COMMIT. Giữa hai lượt ghi đó,
   * mã 6 số vừa dùng vẫn còn hiệu lực:
   *
   *   - Không cần lỗi gì cả, chỉ cần đồng thời. Hai request `/login/totp` mang CÙNG một mã,
   *     cả hai đọc `totp_last_timestep` cũ, cả hai qua cửa, cả hai được cấp phiên. Một mã đổi
   *     ra hai phiên — đúng thứ NFR-01 sinh ra để chặn.
   *   - Và nếu lượt ghi thứ hai hỏng (DB chớp, pool cạn, worker bị kill), mốc KHÔNG BAO GIỜ
   *     nhảy: mã đó dùng lại được cho tới hết chu kỳ 30 giây, im lặng, không dòng lỗi nào.
   *
   * Gói chung transaction với lượt cấp phiên thì hỏng ở đâu cũng rollback cả hai — hoặc người
   * dùng vào được VÀ mã bị đốt, hoặc không có gì xảy ra. Không còn trạng thái ở giữa.
   * `revokeWithin` cũng không có bản chạy-trên-pool vì đúng lý do này.
   *
   * ===== VÀ VÌ SAO CHỪNG ĐÓ VẪN CHƯA ĐỦ =====
   *
   * Câu "không còn trạng thái ở giữa" ở trên đúng với SỰ CỐ và sai với ĐỒNG THỜI. Lượt ĐỌC —
   * `requireUser()` rồi `totp.verify({ lastUsedTimeStep })` — vẫn chạy trên pool, NGOÀI
   * transaction; nếu câu ghi này là `SET ... WHERE id = $2` vô điều kiện thì ở READ COMMITTED
   * hai lượt không thấy nhau:
   *
   *     T1 đọc last = 100  ·  T2 đọc last = 100     (cùng một mã 6 số, timestep 101)
   *     T1 verify OK       ·  T2 verify OK
   *     T1 UPDATE → 101 COMMIT  ·  T2 UPDATE → 101 COMMIT
   *
   * MỘT mã 6 số ra HAI phiên đã step-up. Đây là ca AitM/proxy phishing: kẻ tấn công chộp mã
   * nạn nhân đang gửi rồi bắn SONG SONG thay vì gửi lại sau (gửi lại thì đã bị chặn đúng).
   *
   * Vị từ `< timeStep` làm hai việc trong một câu:
   *   · loại trừ hai lượt cùng timestep — lượt sau khớp 0 dòng;
   *   · và cấm mốc ĐI LÙI. `epochTolerance` nhận cả timestep liền trước, nên hai lượt song
   *     song có thể mang hai timestep khác nhau; ghi lùi là mở lại đúng cái mã vừa đốt.
   *
   * Trả về `false` chứ không ném: nơi gọi biết đây là mã đã dùng và ném đúng `TOTP_REPLAYED`.
   * `api/test/totp-replay-cas.spec.ts` giữ hợp đồng này bằng hai kết nối thật, kèm vế đối
   * chứng chạy câu ghi CŨ để chứng minh lỗ có thật.
   */
  async setTotpLastTimestepWithin(tx: Tx, userId: string, timeStep: number): Promise<boolean> {
    const rows = await tx
      .update(usersTable)
      .set({ totpLastTimestep: timeStep })
      .where(
        and(
          eq(usersTable.id, userId),
          or(isNull(usersTable.totpLastTimestep), lt(usersTable.totpLastTimestep, timeStep)),
        ),
      )
      .returning({ id: usersTable.id });
    return rows.length === 1;
  }

  /**
   * Thay yếu tố thứ hai của tài khoản ĐANG có 2 lớp bằng secret mới, đồng thời đốt mã vừa dùng
   * để xác nhận nó.
   *
   * Một câu duy nhất để không có khoảnh khắc nào tài khoản mang secret mới mà mốc chống replay
   * vẫn là của secret cũ. Vị từ `totp_enrolled_at IS NOT NULL`: SA vừa đặt lại 2 lớp thì người
   * dùng phải đi đường cài lần đầu, không được đường "cài lại" ghi đè lên trạng thái SA vừa đặt.
   */
  async replaceTotpSecretWithin(
    tx: Tx,
    userId: string,
    sealed: SealedValue,
    timeStep: number,
  ): Promise<boolean> {
    const rows = await tx
      .update(usersTable)
      .set({
        totpSecretCt: sealed.ciphertext,
        totpSecretIv: sealed.iv,
        totpSecretTag: sealed.tag,
        totpDekWrapped: sealed.wrappedDek,
        totpKeyVersion: sealed.keyVersion,
        totpEnrolledAt: new Date(),
        totpLastTimestep: timeStep,
        updatedAt: new Date(),
      })
      .where(and(eq(usersTable.id, userId), isNotNull(usersTable.totpEnrolledAt)))
      .returning({ id: usersTable.id });
    return rows.length === 1;
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
   * Đọc bộ đếm sai của tài khoản và GIỮ khoá hàng tới hết `tx`.
   *
   * Cửa cấp phiên phải kiểm lại bậc chờ ở đây chứ không tin lần đọc đầu `login()`: lần đó chạy
   * ngoài transaction, nên một lượt sai song song có thể đẩy tài khoản lên bậc chờ trong lúc
   * lượt đúng còn đang băm Argon2 (SEC-03, khe L8).
   */
  async lockLoginStateWithin(tx: Tx, userId: string): Promise<LockoutState> {
    const rows = await tx
      .select({
        failedAttempts: usersTable.failedAttempts,
        lockedUntil: usersTable.lockedUntil,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for('update');
    return rows[0] ?? { failedAttempts: 0, lockedUntil: null };
  }

  /**
   * Cộng MỘT lượt sai đăng nhập (mật khẩu hoặc TOTP) vào bộ đếm của tài khoản, trong `tx`.
   *
   * `SELECT ... FOR UPDATE` bắt các lượt song song xếp hàng ở hàng này, nên mỗi lượt đếm đúng
   * một lần (đọc-rồi-ghi-đè ngoài khoá thì N lượt song song chỉ đếm được 1). Luật chặn nằm ở
   * `registerAccountFailure` (`common/lockout.ts`), không viết lại bằng SQL ở đây.
   */
  async registerLoginFailureWithin(
    tx: Tx,
    userId: string,
    policy: BackoffPolicy,
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

    const next = registerAccountFailure(current[0], policy, now);
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

  /**
   * MẬT KHẨU đã đúng → xoá dấu vết đoán mật khẩu. KHÔNG đóng dấu `last_login_at`.
   *
   * ===== VÌ SAO TÁCH LÀM HAI =====
   *
   * Một hàm làm cả hai việc sẽ chạy ngay sau khi Argon2 xác minh xong — tức TRƯỚC bước TOTP.
   * Với tài khoản bật `totp_login_required` (mặc định là mọi tài khoản), người gõ đúng mật
   * khẩu nhưng không có điện thoại sẽ khiến `last_login_at` nhảy sang thời điểm đó.
   *
   * Hai bộ đếm thì xoá ở đây là ĐÚNG: chúng đếm việc đoán MẬT KHẨU, mà việc đó vừa kết thúc.
   *
   * `last_login_at` thì không. Nó là câu trả lời cho "người này vào lần cuối lúc nào", hiện
   * thẳng trên màn Tài khoản và là thứ SA nhìn khi rà tài khoản bỏ quên hoặc khi truy vết một
   * vụ việc. Đóng dấu nó cho một lượt CHƯA vào được biến nó thành câu trả lời sai — và sai
   * theo hướng nguy hiểm: một kẻ có mật khẩu nhưng bị chặn ở cửa TOTP để lại đúng dấu vết của
   * một lần đăng nhập bình thường.
   */
  async clearLoginFailures(userId: string, tx?: Tx): Promise<void> {
    await (tx ?? this.db)
      .update(usersTable)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(usersTable.id, userId));
  }

  /**
   * Đóng dấu `last_login_at` — chỉ gọi khi phiên đã xác thực ĐỦ.
   *
   * Nhận `tx` và không có bản chạy trên pool: mốc này phải commit cùng lượt cấp phiên, nếu
   * không lại sinh ra đúng thứ vừa sửa — một mốc đăng nhập không có phiên nào đi kèm.
   */
  async markLoginCompletedWithin(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  /**
   * `email → họ tên` cho một mẻ email — cửa để module khác khỏi tự viết `LEFT JOIN users`
   * (AD-2).
   *
   * MỘT câu hỏi cho cả trang, không phải một câu mỗi dòng: viewer audit hiện 50 dòng/trang và
   * phần lớn do vài người thao tác, nên mẻ thật thường chỉ vài email.
   *
   * Map trả về tra KHÔNG phân biệt hoa-thường (khóa lưu chữ thường). Cột `email` là `citext`
   * nên `WHERE email IN (...)` khớp không phân biệt hoa-thường ở tầng DB — nhưng `Map.get()`
   * bên JS thì phân biệt, còn email ở bảng khác lưu đúng như lúc gõ. Bắt từng nơi gọi nhớ
   * `toLowerCase()` thì chỗ quên hiện email thô thay cho tên — sai lặng lẽ, không gì đỏ.
   */
  async namesByEmails(emails: string[]): Promise<Map<string, string>> {
    if (emails.length === 0) return new Map();
    const rows = await this.db
      .select({ email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(inArray(usersTable.email, emails));
    return new EmailKeyedMap(rows.map((row) => [row.email, row.fullName]));
  }

  /** Vai hiện tại theo email (cột citext nên không phân biệt hoa thường); `null` nếu không có. */
  async roleByEmail(email: string): Promise<UserRole | null> {
    const rows = await this.db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return (rows[0]?.role as UserRole | undefined) ?? null;
  }

  /** `id → họ tên` cho một mẻ id — người tải giấy tờ lên (cột `file.uploaded_by` là id). */
  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  /** `id → email` cho một mẻ id — nhãn đối tượng `user`/`session` trên màn Nhật ký. */
  async emailsByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    return new Map(rows.map((row) => [row.id, row.email]));
  }

  /**
   * Danh bạ tối thiểu: chỉ năm cột, không phân trang (bảng nhân sự IT, vài trăm dòng). Chọn cột
   * ngay trong SELECT để hash mật khẩu, TOTP, SĐT… không bao giờ rời DB theo đường này.
   */
  async directory(): Promise<UserDirectoryEntry[]> {
    const rows = await this.db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
        role: usersTable.role,
        status: usersTable.status,
      })
      .from(usersTable)
      .orderBy(asc(usersTable.fullName), asc(usersTable.email));
    return rows as UserDirectoryEntry[];
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
/** Bộ lọc màn Tài khoản: "ai đang khóa", "admin nào chưa cài 2 lớp", "danh sách SA". */
export interface UserListFilters {
  role?: UserRole;
  status?: UserRecord['status'];
  /** `none` = chưa cài 2 lớp, `enrolled` = đã cài. */
  totp?: 'none' | 'enrolled';
}

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
  // Chốt hạ bằng `email` (duy nhất, `users_email_key`): không cột nào trong whitelist ở
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
    tempPasswordExpiresAt: row.tempPasswordExpiresAt ?? null,
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

/** Map `email → họ tên` tra không phân biệt hoa-thường — xem `namesByEmails`. */
class EmailKeyedMap extends Map<string, string> {
  override get(email: string): string | undefined {
    return super.get(email.toLowerCase());
  }

  override has(email: string): boolean {
    return super.has(email.toLowerCase());
  }

  override set(email: string, name: string): this {
    return super.set(email.toLowerCase(), name);
  }
}

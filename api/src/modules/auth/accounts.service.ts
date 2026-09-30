import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DRIZZLE_DB } from "../../database/database.module";
import type { Database } from "../../database/database.module";
import type { Page, PageQuery } from "../../common/pagination";
import { conflictOnUnique, pgConstraint } from "../../common/sql";
import { generateTemporaryPassword } from "../../common/temporary-password";
import type { SortQuery } from "../../common/sorting";
import type { Tx } from "../../common/tx";
import { ApprovalsApiService } from "../approvals/approvals.api";
import { AuditWriterService } from "../audit/audit-writer.service";
import { OutboxService } from "../outbox/outbox.service";
import {
  UsersService,
  type UserListFilters,
  type UserSortKey,
} from "../users/users.service";
import type { UserRecord } from "../users/users.types";
import { LoginFailureService } from "./login-failure.service";
import { PasswordService } from "./password.service";
import { SessionService, type SessionSummary } from "./session.service";
import type { UserRole } from "./types";

export interface ActorRef {
  id: string;
  email: string;
}

/**
 * Mã nhật ký của từng trạng thái đích — viết thẳng thành chuỗi để `@Audited` của route khai
 * đúng tập này (`accounts-audited.spec.ts`) và bài điểm danh nhãn bên web đọc được.
 */
export const ACCOUNT_STATUS_ACTION = {
  active: "account.unlocked",
  locked: "account.locked",
  disabled: "account.disabled",
} as const;

/**
 * SA quản trị tài khoản và phiên.
 * Luật sống còn: KHÔNG XÓA user bao giờ (convention "Xóa") và không được để hệ thống
 * còn dưới 2 SA hoạt động (NFR-01 dual control).
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditWriterService,
    private readonly outbox: OutboxService,
    private readonly loginFailures: LoginFailureService,
    private readonly approvals: ApprovalsApiService,
  ) {}

  list(
    query: PageQuery,
    search?: string,
    sort?: SortQuery<UserSortKey>,
    filters?: UserListFilters,
  ): Promise<Page<UserRecord>> {
    return this.users.list(query, search, sort, filters);
  }

  /** Tạo user + mật khẩu tạm; buộc đổi mật khẩu và enroll TOTP ở lần đăng nhập đầu. */
  async create(
    actor: ActorRef,
    input: {
      email: string;
      fullName: string;
      phone?: string;
      employeeCode?: string;
      birthDate?: string;
      role: UserRole;
      totpLoginRequired?: boolean;
    },
  ): Promise<{ user: UserRecord; temporaryPassword: string }> {
    const existing = await this.users.findCredentialsByEmail(input.email);
    if (existing) {
      throw new ConflictException({
        code: "EMAIL_TAKEN",
        message: "Email này đã có tài khoản.",
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    /*
     * Bọc cả transaction: `users_employee_code_uq` là index duy nhất MỘT PHẦN, và
     * `create` không hề tra trước như đã tra email. Không dịch mã lỗi ở đây thì SA gõ trùng
     * một mã nhân viên là nhận 500 trắng, không biết ô nào đụng.
     * `updateProfile` bên dưới đã dịch đúng — hai đường ghi phải nói cùng một câu.
     */
    const user = await this.createUser(actor, input, passwordHash);
    return { user, temporaryPassword };
  }

  private async createUser(
    actor: ActorRef,
    input: {
      email: string;
      fullName: string;
      phone?: string;
      employeeCode?: string;
      birthDate?: string;
      role: UserRole;
      totpLoginRequired?: boolean;
    },
    passwordHash: string,
  ): Promise<UserRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const created = await this.users.createWithin(tx, {
          email: input.email.trim(),
          fullName: input.fullName.trim(),
          // Chuỗi rỗng = KHÔNG KHAI, phải thành NULL: để rỗng thì index duy nhất của mã nhân
          // viên coi hai người cùng "chưa khai" là trùng nhau và chặn người thứ hai.
          phone: blankToNull(input.phone),
          employeeCode: blankToNull(input.employeeCode),
          birthDate: blankToNull(input.birthDate),
          role: input.role,
          passwordHash,
          totpLoginRequired: input.totpLoginRequired ?? true,
        });
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: "account.created",
          objectType: "user",
          objectId: created.id,
          detail: { email: created.email, role: created.role },
        });
        await this.outbox.enqueueWithin(tx, "account.created", {
          userId: created.id,
        });
        return created;
      });
    } catch (error) {
      /*
       * Đọc TÊN ràng buộc, không đoán.
       *
       * Bảng `users` có HAI khóa duy nhất: `email` và `users_employee_code_uq`.
       * Tra email ở trên là TOCTOU — hai SA cùng gửi một email (hay một người bấm Lưu hai
       * lần) thì lượt sau đụng khóa email. Gán mọi 23505 vào một câu là chỉ sai hẳn ô: người
       * dùng đọc `Mã nhân viên "" đã thuộc về một tài khoản khác` trong khi họ để trống ô đó.
       */
      if (pgConstraint(error) === "users_employee_code_uq") {
        throw conflictOnUnique(
          error,
          {
            code: "EMPLOYEE_CODE_TAKEN",
            message: `Mã nhân viên "${(input.employeeCode ?? "").trim()}" đã thuộc về một tài khoản khác.`,
          },
          "users_employee_code_uq",
        );
      }
      // Không phải khóa mã nhân viên → hoặc trùng email, hoặc không phải 23505 (đi qua nguyên vẹn).
      throw conflictOnUnique(error, {
        code: "EMAIL_TAKEN",
        message: "Email này đã có tài khoản.",
      });
    }
  }

  /**
   * Sửa hồ sơ: họ tên, SĐT, mã nhân viên.
   *
   * KHÔNG đụng email — email là danh tính đăng nhập, đổi nó là đổi người. Ai cần đổi email
   * thì tạo tài khoản mới và vô hiệu hoá cái cũ, để nhật ký cũ vẫn trỏ đúng người đã làm.
   */
  async updateProfile(
    actor: ActorRef,
    userId: string,
    input: {
      fullName: string;
      phone?: string;
      employeeCode?: string;
      birthDate?: string;
    },
  ): Promise<UserRecord> {
    const before = await this.users.findById(userId);
    if (!before) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "Không tìm thấy tài khoản.",
      });
    }
    /*
     * THIẾU một ô nghĩa là "đừng đụng tới", KHÔNG phải "xoá đi" — chuỗi RỖNG mới là xoá.
     *
     * Ba ô này đều `@IsOptional()` trong `ProfileDto`, nên một `PATCH {fullName}` — đúng bộ
     * tối thiểu DTO cho phép — sẽ ghi `null` đè lên SĐT, mã nhân viên và ngày sinh. Form
     * hiện tại luôn gửi đủ ô nên chỗ này chỉ cắn người gọi API, và cắn im lặng.
     */
    const keep = (raw: string | undefined, current: string | null): string | null =>
      raw === undefined ? current : blankToNull(raw);

    const values = {
      fullName: input.fullName.trim(),
      phone: keep(input.phone, before.phone),
      employeeCode: keep(input.employeeCode, before.employeeCode),
      birthDate: keep(input.birthDate, before.birthDate),
    };

    try {
      return await this.db.transaction(async (tx) => {
        const updated = await this.users.updateProfileWithin(
          tx,
          userId,
          values,
        );
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: "account.profile.updated",
          objectType: "user",
          objectId: userId,
          detail: {
            fullName: { before: before.fullName, after: values.fullName },
            phone: { before: before.phone, after: values.phone },
            employeeCode: {
              before: before.employeeCode,
              after: values.employeeCode,
            },
            birthDate: { before: before.birthDate, after: values.birthDate },
          },
        });
        return updated;
      });
    } catch (error) {
      /*
       * Mã nhân viên trùng: nói RÕ trùng cái gì. 500 chung chung thì người nhập ngồi đoán.
       *
       * Nhưng phải đọc TÊN ràng buộc như nhánh tạo mới ở trên, không gán mọi 23505 vào đây.
       * `users` còn khóa duy nhất trên `email`, và lượt ghi này còn chạm `user_history` —
       * một 23505 từ chỗ khác sẽ hiện ra câu `Mã nhân viên "" đã thuộc về một tài khoản
       * khác` trong khi người dùng để trống đúng ô đó, và lỗi thật thì bị nuốt mất.
       */
      throw conflictOnUnique(
        error,
        {
          code: "EMPLOYEE_CODE_TAKEN",
          message: `Mã nhân viên "${values.employeeCode}" đã thuộc về một tài khoản khác.`,
        },
        "users_employee_code_uq",
      );
    }
  }

  /** Khóa/mở tài khoản. Khóa → mọi phiên chết ngay (NFR-01). */
  async setStatus(
    actor: ActorRef,
    userId: string,
    status: "active" | "locked" | "disabled",
    /** Lý do khóa / vô hiệu hóa — vết an ninh: "nghi lộ mật khẩu" khác "nghỉ việc". */
    reason?: string,
  ): Promise<void> {
    const user = await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      /*
       * Đếm SA BÊN TRONG transaction, và khóa các hàng đếm được.
       *
       * Gọi `assertNotLastSa` NGOÀI transaction thì hỏng: hệ thống còn đúng 3 SA, hai lệnh
       * khóa chạy song song trên hai SA khác nhau: cả hai đếm được "còn 2 SA hoạt động", cả
       * hai qua cửa, cả hai ghi. Kết quả là còn 1 SA — và với đúng 2 SA thì kết quả là còn 0,
       * tức KHÓA CẢ CÔNG TY RA NGOÀI hệ thống, không ai mở lại được vì mở cũng cần quyền SA.
       */
      if (status !== "active") {
        await this.assertNotLastSaWithin(tx, user.role, userId);
      }
      await this.users.setStatusWithin(tx, userId, status);
      /*
       * "Cho vào lại" phải vào được NGAY: bộ đếm sai của tài khoản và bậc giãn chậm theo IP
       * còn nguyên thì người vừa được mở vẫn bị chặn thêm, trong khi màn báo "Đang hoạt động".
       * Khoá thì KHÔNG xoá — bộ đếm là bằng chứng đang bị dò mật khẩu.
       */
      if (status === "active") {
        await this.users.clearLoginFailures(userId, tx);
        await this.loginFailures.clearAllForUserWithin(tx, userId);
      }
      const killed =
        status === "active"
          ? 0
          : await this.sessions.revokeAllForUserWithin(
              tx,
              userId,
              `status:${status}`,
            );
      /*
       * Vô hiệu hóa = người này thôi làm việc với hệ thống: yêu cầu mở két đang chờ của họ bị
       * rút cùng transaction (Q-15), để người duyệt không cấp quyền cho một tài khoản đã tắt.
       * Chỉ KHÓA thì giữ — khóa là tạm, mở lại thì việc đang chờ vẫn còn nguyên.
       */
      const withdrawn =
        status === "disabled"
          ? await this.approvals.withdrawPendingOfWithin(tx, user.email, {
              actor: actor.email,
              note: "Tài khoản của người xin đã bị vô hiệu hóa.",
            })
          : 0;
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: ACCOUNT_STATUS_ACTION[status],
        objectType: "user",
        objectId: userId,
        detail: {
          revokedSessions: killed,
          ...(status === "disabled" ? { withdrawnRequests: withdrawn } : {}),
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        },
      });
    });
  }

  /**
   * Đổi vai trò sau khi tạo — thăng/hạ mà không phải tạo tài khoản thứ hai (lịch sử bị cắt đôi).
   *
   * Vai đọc lại từ `users` ở MỖI request (`session.guard.ts`), nên đổi xong có tác dụng ngay,
   * không cần đá phiên. Hai hàng rào: không hạ SA khi hệ thống chỉ còn 2 SA hoạt động (NFR-01,
   * đếm + khóa hàng TRONG cùng transaction như `setStatus`), và không tự đổi vai của chính mình
   * (tự hạ mình là mất quyền ngay giữa thao tác, tự nâng thì không có ai duyệt).
   */
  async setRole(actor: ActorRef, userId: string, role: UserRole): Promise<void> {
    if (actor.id === userId) {
      throw new BadRequestException({
        code: "SELF_ROLE_CHANGE",
        message: "Không tự đổi vai trò của chính mình — nhờ một SA khác.",
      });
    }
    const user = await this.requireUser(userId);
    if (user.role === role) return;
    await this.db.transaction(async (tx) => {
      if (user.status === "active") {
        await this.assertNotLastSaWithin(tx, user.role, userId);
      }
      await this.users.setRoleWithin(tx, userId, role);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "account.role.changed",
        objectType: "user",
        objectId: userId,
        detail: { before: user.role, after: role },
      });
    });
  }

  /** Reset mật khẩu: sinh mật khẩu tạm, buộc đổi, đá sạch phiên cũ. */
  async resetPassword(
    actor: ActorRef,
    userId: string,
  ): Promise<{ temporaryPassword: string }> {
    await this.requireUser(userId);
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.passwords.hash(temporaryPassword);
    await this.db.transaction(async (tx) => {
      await this.users.setPasswordWithin(tx, userId, hash, true);
      const killed = await this.sessions.revokeAllForUserWithin(
        tx,
        userId,
        "password-reset",
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "account.password.reset",
        objectType: "user",
        objectId: userId,
        detail: { revokedSessions: killed },
      });
      await this.outbox.enqueueWithin(tx, "account.password.reset", { userId });
    });
    return { temporaryPassword };
  }

  /** Reset MFA (mất điện thoại): xóa secret, buộc enroll lại, đá sạch phiên. */
  async resetTotp(actor: ActorRef, userId: string): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      await this.users.clearTotpWithin(tx, userId);
      const killed = await this.sessions.revokeAllForUserWithin(
        tx,
        userId,
        "mfa-reset",
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "account.mfa.reset",
        objectType: "user",
        objectId: userId,
        detail: { revokedSessions: killed },
      });
      await this.outbox.enqueueWithin(tx, "account.mfa.reset", { userId });
    });
  }

  /** NFR-01: cưỡng chế TOTP lúc đăng nhập bật/tắt theo từng người. */
  async setTotpLoginRequired(
    actor: ActorRef,
    userId: string,
    required: boolean,
  ): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      await this.users.setTotpLoginRequiredWithin(tx, userId, required);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "account.totp_login_required.changed",
        objectType: "user",
        objectId: userId,
        detail: { required },
      });
    });
  }

  listSessions(userId: string): Promise<SessionSummary[]> {
    return this.sessions.listActive(userId);
  }

  /** Nơi (IP) đang tạm chặn / đang đếm sai của người này — SA đọc khi người dùng báo không vào được. */
  listLockouts(userId: string) {
    return this.loginFailures.listForUser(userId);
  }

  /** SA đá một phiên cụ thể (NFR-01). */
  async killSession(actor: ActorRef, sessionId: string): Promise<void> {
    const session = await this.sessions.find(sessionId);
    if (!session) {
      throw new NotFoundException({
        code: "SESSION_NOT_FOUND",
        message: "Phiên không tồn tại.",
      });
    }
    /*
     * MỘT transaction cho đá-phiên + ghi vết (AD-5).
     *
     * Thu hồi chạy trên pool và COMMIT NGAY rồi mới ghi audit riêng thì khi transaction thứ
     * hai hỏng — pool cạn, worker bị kill — phiên ĐÃ CHẾT mà không còn dòng nào nói ai đá và
     * đá lúc nào; `audit_log` chỉ-thêm nên không có đường bù. Đúng cửa mà NFR-03 sinh ra để
     * trả lời: SA nghi tài khoản bị chiếm, đá phiên, rồi tuần sau phải chứng minh mình đã làm
     * gì.
     *
     * Cùng khuôn với `verifyLoginTotp`, `stepUp()`, `logout()`.
     */
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeWithin(tx, sessionId, `killed-by:${actor.email}`);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "session.killed",
        objectType: "session",
        objectId: sessionId,
        detail: { userId: session.userId },
      });
    });
  }

  /**
   * SA đóng mọi phiên của một người (nghi bị chiếm, người đó báo mất máy).
   *
   * Phiên SA đang dùng được giữ lại trừ khi chọn rõ `includeCurrent`: SA đóng phiên của chính
   * mình để "đuổi" một máy lạ mà lại tự văng ra giữa lúc xử lý sự cố là phản tác dụng.
   * Một transaction cho thu hồi + nhật ký (AD-5).
   */
  async killAllSessions(
    actor: ActorRef,
    userId: string,
    opts: { currentSessionId: string | undefined; includeCurrent: boolean },
  ): Promise<number> {
    await this.requireUser(userId);
    const keep = opts.includeCurrent ? undefined : opts.currentSessionId;
    return this.db.transaction(async (tx) => {
      const killed = await this.sessions.revokeAllForUserWithin(
        tx,
        userId,
        `killed-by:${actor.email}`,
        keep,
      );
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: "session.killed_all",
        objectType: "user",
        objectId: userId,
        detail: { revokedSessions: killed, includeCurrent: opts.includeCurrent },
      });
      return killed;
    });
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "Không tìm thấy tài khoản.",
      });
    }
    return user;
  }

  /**
   * NFR-01: luôn còn tối thiểu 2 SA hoạt động — chặn tự khóa mình thành hệ thống không SA.
   *
   * Nhận `tx` và chỉ nhận `tx`: phép đếm này chỉ có giá trị nếu nó chạy trong CÙNG
   * transaction với câu ghi mà nó bảo vệ, và nếu nó khóa các hàng vừa đếm. Bản chạy trên
   * pool đã bị xóa khỏi `UsersService` để không ai vô tình cầm nhầm cái tiện tay.
   */
  private async assertNotLastSaWithin(tx: Tx, role: string, userId: string): Promise<void> {
    if (role !== "sa") return;
    const remaining = await this.users.countActiveSaWithin(tx, userId);
    if (remaining < 2) {
      throw new BadRequestException({
        code: "LAST_SA",
        message:
          "Hệ thống phải luôn còn ít nhất 2 SA hoạt động. Bổ nhiệm SA khác trước khi khóa hoặc hạ vai tài khoản này.",
      });
    }
  }
}

/** Chuỗi rỗng ≠ giá trị rỗng: "chưa khai" phải là NULL, xem chú thích ở chỗ gọi. */
function blankToNull(value?: string | null): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

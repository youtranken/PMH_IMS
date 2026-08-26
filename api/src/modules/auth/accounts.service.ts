import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Page, PageQuery } from '../../common/pagination';
import { pgErrorCode, PG_UNIQUE_VIOLATION } from '../../common/sql';
import type { SortQuery } from '../../common/sorting';
import { AuditWriterService } from '../audit/audit-writer.service';
import { OutboxService } from '../outbox/outbox.service';
import { UsersService, type UserSortKey } from '../users/users.service';
import type { UserRecord } from '../users/users.types';
import { PasswordService } from './password.service';
import { checkPasswordStrength } from './password-policy';
import { SessionService, type SessionRecord } from './session.service';
import type { UserRole } from './types';

export interface ActorRef {
  id: string;
  email: string;
}

/**
 * SA quản trị tài khoản và phiên (story 1.4).
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
  ) {}

  list(
    query: PageQuery,
    search?: string,
    sort?: SortQuery<UserSortKey>,
  ): Promise<Page<UserRecord>> {
    return this.users.list(query, search, sort);
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
        code: 'EMAIL_TAKEN',
        message: 'Email này đã có tài khoản.',
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const user = await this.db.transaction(async (tx) => {
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
        action: 'account.created',
        objectType: 'user',
        objectId: created.id,
        detail: { email: created.email, role: created.role },
      });
      await this.outbox.enqueueWithin(tx, 'account.created', { userId: created.id });
      return created;
    });
    return { user, temporaryPassword };
  }

  /**
   * Sửa hồ sơ: họ tên, SĐT, mã nhân viên (0031).
   *
   * KHÔNG đụng email — email là danh tính đăng nhập, đổi nó là đổi người. Ai cần đổi email
   * thì tạo tài khoản mới và vô hiệu hoá cái cũ, để nhật ký cũ vẫn trỏ đúng người đã làm.
   */
  async updateProfile(
    actor: ActorRef,
    userId: string,
    input: { fullName: string; phone?: string; employeeCode?: string; birthDate?: string },
  ): Promise<UserRecord> {
    const before = await this.users.findById(userId);
    if (!before) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
    }
    const values = {
      fullName: input.fullName.trim(),
      phone: blankToNull(input.phone),
      employeeCode: blankToNull(input.employeeCode),
      birthDate: blankToNull(input.birthDate),
    };

    try {
      return await this.db.transaction(async (tx) => {
        const updated = await this.users.updateProfileWithin(tx, userId, values);
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: 'account.profile.updated',
          objectType: 'user',
          objectId: userId,
          detail: {
            fullName: { before: before.fullName, after: values.fullName },
            phone: { before: before.phone, after: values.phone },
            employeeCode: { before: before.employeeCode, after: values.employeeCode },
            birthDate: { before: before.birthDate, after: values.birthDate },
          },
        });
        return updated;
      });
    } catch (error) {
      // Mã nhân viên trùng: nói RÕ trùng cái gì. 500 chung chung thì người nhập ngồi đoán.
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException({
          code: 'EMPLOYEE_CODE_TAKEN',
          message: `Mã nhân viên "${values.employeeCode}" đã thuộc về một tài khoản khác.`,
        });
      }
      throw error;
    }
  }

  /** Khóa/mở tài khoản. Khóa → mọi phiên chết ngay (NFR-01). */
  async setStatus(
    actor: ActorRef,
    userId: string,
    status: 'active' | 'locked' | 'disabled',
  ): Promise<void> {
    const user = await this.requireUser(userId);
    if (status !== 'active') {
      await this.assertNotLastSa(user.role, userId);
    }
    await this.db.transaction(async (tx) => {
      await this.users.setStatusWithin(tx, userId, status);
      const killed =
        status === 'active'
          ? 0
          : await this.sessions.revokeAllForUserWithin(tx, userId, `status:${status}`);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: `account.${status === 'active' ? 'unlocked' : status}`,
        objectType: 'user',
        objectId: userId,
        detail: { revokedSessions: killed },
      });
    });
  }

  /** Reset mật khẩu: sinh mật khẩu tạm, buộc đổi, đá sạch phiên cũ. */
  async resetPassword(actor: ActorRef, userId: string): Promise<{ temporaryPassword: string }> {
    await this.requireUser(userId);
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.passwords.hash(temporaryPassword);
    await this.db.transaction(async (tx) => {
      await this.users.setPasswordWithin(tx, userId, hash, true);
      const killed = await this.sessions.revokeAllForUserWithin(tx, userId, 'password-reset');
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'account.password.reset',
        objectType: 'user',
        objectId: userId,
        detail: { revokedSessions: killed },
      });
      await this.outbox.enqueueWithin(tx, 'account.password.reset', { userId });
    });
    return { temporaryPassword };
  }

  /** Reset MFA (mất điện thoại): xóa secret, buộc enroll lại, đá sạch phiên. */
  async resetTotp(actor: ActorRef, userId: string): Promise<void> {
    await this.requireUser(userId);
    await this.db.transaction(async (tx) => {
      await this.users.clearTotpWithin(tx, userId);
      const killed = await this.sessions.revokeAllForUserWithin(tx, userId, 'mfa-reset');
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'account.mfa.reset',
        objectType: 'user',
        objectId: userId,
        detail: { revokedSessions: killed },
      });
      await this.outbox.enqueueWithin(tx, 'account.mfa.reset', { userId });
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
        action: 'account.totp_login_required.changed',
        objectType: 'user',
        objectId: userId,
        detail: { required },
      });
    });
  }

  /** Đặt mật khẩu cụ thể (SA seed/khôi phục) — vẫn áp luật mạnh và vẫn đá phiên. */
  async setPassword(actor: ActorRef, userId: string, newPassword: string): Promise<void> {
    await this.requireUser(userId);
    const check = checkPasswordStrength(newPassword);
    if (!check.ok) {
      throw new BadRequestException({ code: 'PASSWORD_WEAK', message: check.reason });
    }
    const hash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await this.users.setPasswordWithin(tx, userId, hash, true);
      await this.sessions.revokeAllForUserWithin(tx, userId, 'password-set-by-sa');
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'account.password.set',
        objectType: 'user',
        objectId: userId,
      });
    });
  }

  listSessions(userId: string): Promise<SessionRecord[]> {
    return this.sessions.listActive(userId);
  }

  /** SA đá một phiên cụ thể (NFR-01). */
  async killSession(actor: ActorRef, sessionId: string): Promise<void> {
    const session = await this.sessions.find(sessionId);
    if (!session) {
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Phiên không tồn tại.' });
    }
    await this.sessions.revoke(sessionId, `killed-by:${actor.email}`);
    await this.audit.append({
      actor: actor.email,
      action: 'session.killed',
      objectType: 'session',
      objectId: sessionId,
      detail: { userId: session.userId },
    });
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Không tìm thấy tài khoản.',
      });
    }
    return user;
  }

  /** NFR-01: luôn còn tối thiểu 2 SA hoạt động — chặn tự khóa mình thành hệ thống không SA. */
  private async assertNotLastSa(role: string, userId: string): Promise<void> {
    if (role !== 'sa') return;
    const remaining = await this.users.countActiveSa(userId);
    if (remaining < 2) {
      throw new BadRequestException({
        code: 'LAST_SA',
        message:
          'Hệ thống phải luôn còn ít nhất 2 SA hoạt động. Bổ nhiệm SA khác trước khi khóa tài khoản này.',
      });
    }
  }
}

/** Chuỗi rỗng ≠ giá trị rỗng: "chưa khai" phải là NULL, xem chú thích ở chỗ gọi. */
function blankToNull(value?: string | null): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Mật khẩu tạm: 16 ký tự từ bảng chữ không gây nhầm lẫn khi đọc qua điện thoại
 * (bỏ 0/O, 1/l/I). Người dùng buộc đổi ngay lần đăng nhập đầu.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%';
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

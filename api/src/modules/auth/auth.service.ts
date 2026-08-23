import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { AuditWriterService } from '../audit/audit-writer.service';
import { OutboxService } from '../outbox/outbox.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersService } from '../users/users.service';
import type { UserCredentials } from '../users/users.types';
import { isLocked, lockRemainingSeconds, registerFailure } from './lockout';
import { PasswordService } from './password.service';
import { checkPasswordStrength } from './password-policy';
import { SessionService, type SessionRecord } from './session.service';
import { TotpService } from './totp.service';
import { KnownDeviceService } from './known-device.service';

/** AAD của TOTP secret: bảng users + id user (NFR-02). */
const TOTP_TABLE = 'users';

export interface LoginContext {
  ip: string | null;
  userAgent: string | null;
}

export type LoginOutcome =
  | { status: 'authenticated'; session: SessionRecord; mustChangePassword: boolean }
  | { status: 'totp-required'; session: SessionRecord }
  | { status: 'totp-enroll-required'; session: SessionRecord };

/**
 * Luồng đăng nhập (NFR-01, AD-8). Mọi ghi đi trong transaction tường minh (AD-5),
 * mọi kết cục đều có một dòng audit (NFR-03), mọi email đi qua outbox.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly envelope: EnvelopeCryptoService,
    private readonly audit: AuditWriterService,
    private readonly outbox: OutboxService,
    private readonly config: SystemConfigService,
    private readonly devices: KnownDeviceService,
  ) {}

  async login(email: string, password: string, ctx: LoginContext): Promise<LoginOutcome> {
    const [idleAbsolute, maxFailed, lockoutMinutes] = await Promise.all([
      this.config.getNumber('sessionAbsoluteHours'),
      this.config.getNumber('loginMaxFailedAttempts'),
      this.config.getNumber('loginLockoutMinutes'),
    ]);

    const user = await this.users.findCredentialsByEmail(email.trim());
    // Không tiết lộ email có tồn tại hay không (user enumeration) — luôn cùng một thông điệp.
    if (!user) {
      await this.audit.append({
        actor: email,
        action: 'auth.login.failed',
        objectType: 'user',
        detail: { reason: 'not-found', ip: ctx.ip },
      });
      throw new UnauthorizedException({
        code: 'LOGIN_FAILED',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    if (user.status === 'disabled') {
      await this.auditFailure(user, 'disabled', ctx);
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Tài khoản đã bị vô hiệu hóa. Liên hệ SA.',
      });
    }

    const now = new Date();
    if (isLocked({ failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil }, now)) {
      const seconds = lockRemainingSeconds(
        { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil },
        now,
      );
      await this.auditFailure(user, 'locked', ctx);
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: `Tài khoản đang bị khóa. Thử lại sau ${Math.ceil(seconds / 60)} phút.`,
        retryAfterSeconds: seconds,
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      const next = registerFailure(
        { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil },
        { maxFailedAttempts: maxFailed, lockoutMinutes },
        now,
      );
      await this.users.applyLockoutState(user.id, {
        failedAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil,
      });
      await this.auditFailure(user, 'bad-password', ctx);
      if (next.justLocked) {
        // Email báo SA đi qua outbox (AD-5) — không gửi thẳng trong request.
        await this.db.transaction(async (tx) => {
          await this.audit.appendWithin(tx, {
            actor: user.email,
            action: 'auth.account.locked',
            objectType: 'user',
            objectId: user.id,
            detail: { failedAttempts: next.failedAttempts, ip: ctx.ip },
          });
          await this.outbox.enqueueWithin(tx, 'auth.account.locked', { userId: user.id });
        });
      }
      throw new UnauthorizedException({
        code: 'LOGIN_FAILED',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    const needsTotp = user.totpLoginRequired;
    const enrolled = user.totpEnrolledAt !== null;

    const session = await this.db.transaction(async (tx) => {
      const created = await this.sessions.createWithin(tx, {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        absoluteHours: idleAbsolute,
        totpPending: needsTotp,
      });
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: needsTotp ? 'auth.password.ok' : 'auth.login.ok',
        objectType: 'session',
        objectId: created.id,
        detail: { ip: ctx.ip, totpPending: needsTotp },
      });
      await this.noticeNewDevice(tx, user, ctx);
      return created;
    });

    await this.users.markLoginSuccess(user.id);

    if (needsTotp && !enrolled) return { status: 'totp-enroll-required', session };
    if (needsTotp) return { status: 'totp-required', session };
    return { status: 'authenticated', session, mustChangePassword: user.mustChangePassword };
  }

  /**
   * Bước 2 của đăng nhập: nhập mã TOTP. Đúng thì HỦY phiên chờ và cấp phiên MỚI
   * (regenerate session id sau khi xác thực đủ — NFR-01).
   */
  async verifyLoginTotp(
    session: SessionRecord,
    token: string,
    ctx: LoginContext,
  ): Promise<{ session: SessionRecord; mustChangePassword: boolean }> {
    const user = await this.requireUser(session.userId);
    const secret = this.openTotpSecret(user);
    const result = await this.totp.verify({
      token,
      secret,
      lastUsedTimeStep: user.totpLastTimestep,
    });
    if (!result.ok) {
      await this.audit.append({
        actor: user.email,
        action: 'auth.totp.failed',
        objectType: 'session',
        objectId: session.id,
        detail: { reason: result.reason, ip: ctx.ip },
      });
      throw new UnauthorizedException({
        code: result.reason === 'replayed' ? 'TOTP_REPLAYED' : 'TOTP_INVALID',
        message:
          result.reason === 'replayed'
            ? 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.'
            : 'Mã xác thực không đúng.',
      });
    }

    const absoluteHours = await this.config.getNumber('sessionAbsoluteHours');
    const fresh = await this.db.transaction(async (tx) => {
      await this.sessions.revokeWithin(tx, session.id, 'totp-regenerate');
      const created = await this.sessions.createWithin(tx, {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        absoluteHours,
        totpPending: false,
      });
      await this.sessions.completeTotpWithin(tx, created.id);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.login.ok',
        objectType: 'session',
        objectId: created.id,
        detail: { ip: ctx.ip, viaTotp: true },
      });
      return created;
    });
    await this.users.setTotpLastTimestep(user.id, result.timeStep as number);

    return { session: fresh, mustChangePassword: user.mustChangePassword };
  }

  /** Đã cài xác thực 2 lớp chưa — UI dùng để chọn màn enroll hay màn nhập mã. */
  async isTotpEnrolled(userId: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    return user?.totpEnrolledAt !== null && user !== null;
  }

  /** Enroll TOTP: sinh secret, envelope, trả QR. Chưa bật cho tới khi xác nhận đúng mã. */
  async startTotpEnrollment(userId: string): Promise<{ secret: string; qrDataUrl: string }> {
    const user = await this.requireUser(userId);
    if (user.totpEnrolledAt !== null) {
      throw new BadRequestException({
        code: 'TOTP_ALREADY_ENROLLED',
        message: 'Tài khoản đã bật xác thực 2 lớp. Nhờ SA reset nếu đổi điện thoại.',
      });
    }
    const secret = this.totp.generateSecret();
    const sealed = this.envelope.seal(secret, { table: TOTP_TABLE, recordId: user.id });
    await this.db.transaction(async (tx) => {
      await this.users.setTotpSecretWithin(tx, user.id, sealed);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.enroll.start',
        objectType: 'user',
        objectId: user.id,
      });
    });
    return { secret, qrDataUrl: await this.totp.qrDataUrl(user.email, secret) };
  }

  /**
   * Xác nhận enroll bằng mã đầu tiên.
   *
   * Nếu việc này diễn ra NGAY TRONG luồng đăng nhập (phiên còn cờ `totp_pending`), người dùng
   * vừa chứng minh có điện thoại → coi như đã qua bước 2: hủy phiên chờ, cấp phiên MỚI
   * (regenerate id, NFR-01). Không làm bước này thì user kẹt: đã cài xong 2 lớp nhưng
   * mọi request tiếp theo vẫn bị chặn bởi TOTP_REQUIRED.
   */
  async confirmTotpEnrollment(
    session: SessionRecord,
    token: string,
    ctx: LoginContext,
  ): Promise<{ session: SessionRecord }> {
    const user = await this.requireUser(session.userId);
    // Endpoint này CẤP PHIÊN ĐÃ XÁC THỰC, nên nó phải chặt bằng đúng bước 2 của đăng nhập:
    //  - Đã enroll rồi thì không được vào đây nữa. Nếu không, kẻ có mật khẩu + một mã đã dùng
    //    sẽ đi vòng qua chống-replay của `verifyLoginTotp` (mã bị từ chối ở /login/totp nhưng
    //    lại được chấp nhận ở đây) — và `totp_enrolled_at` bị ghi đè, sai dữ liệu SA nhìn thấy.
    //  - Vẫn phải truyền `totpLastTimestep` để mã đã dùng không dùng lại được.
    if (user.totpEnrolledAt !== null) {
      throw new BadRequestException({
        code: 'TOTP_ALREADY_ENROLLED',
        message: 'Tài khoản đã bật xác thực 2 lớp. Nhờ SA reset nếu đổi điện thoại.',
      });
    }
    const secret = this.openTotpSecret(user);
    const result = await this.totp.verify({
      token,
      secret,
      lastUsedTimeStep: user.totpLastTimestep,
    });
    if (!result.ok) {
      await this.audit.append({
        actor: user.email,
        action: 'auth.totp.enroll.failed',
        objectType: 'user',
        objectId: user.id,
        detail: { reason: result.reason },
      });
      throw new UnauthorizedException({
        code: result.reason === 'replayed' ? 'TOTP_REPLAYED' : 'TOTP_INVALID',
        message:
          result.reason === 'replayed'
            ? 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.'
            : 'Mã xác thực không đúng. Kiểm tra đồng hồ điện thoại rồi thử lại.',
      });
    }

    const absoluteHours = await this.config.getNumber('sessionAbsoluteHours');
    const fresh = await this.db.transaction(async (tx) => {
      await this.users.markTotpEnrolledWithin(tx, user.id, result.timeStep as number);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.enroll.done',
        objectType: 'user',
        objectId: user.id,
      });
      if (!session.totpPending) return session;

      await this.sessions.revokeWithin(tx, session.id, 'totp-enroll-regenerate');
      const created = await this.sessions.createWithin(tx, {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        absoluteHours,
        totpPending: false,
      });
      await this.sessions.completeTotpWithin(tx, created.id);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.login.ok',
        objectType: 'session',
        objectId: created.id,
        detail: { ip: ctx.ip, viaTotpEnroll: true },
      });
      return created;
    });

    return { session: fresh };
  }

  /**
   * FR-022 step-up: gõ TOTP để mở quyền xem secret trong `grace` phút.
   * Luôn bắt buộc, kể cả khi `totp_login_required` tắt.
   */
  async stepUp(session: SessionRecord, token: string): Promise<void> {
    const user = await this.requireUser(session.userId);
    if (user.totpEnrolledAt === null) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENROLLED',
        message: 'Chưa bật xác thực 2 lớp — không thể xem bí mật.',
      });
    }
    const secret = this.openTotpSecret(user);
    const result = await this.totp.verify({
      token,
      secret,
      lastUsedTimeStep: user.totpLastTimestep,
    });
    await this.audit.append({
      actor: user.email,
      action: result.ok ? 'auth.stepup.ok' : 'auth.stepup.failed',
      objectType: 'session',
      objectId: session.id,
      detail: result.ok ? undefined : { reason: result.reason },
    });
    if (!result.ok) {
      /**
       * Sai liên tiếp đủ ngưỡng → THU HỒI PHIÊN (code review Epic 4, finding 1).
       *
       * Trước đây gõ sai chỉ ghi audit, nên kẻ cầm cookie phiên trộm được cứ thử mã cho tới
       * khi trúng. Thu hồi PHIÊN chứ không khóa TÀI KHOẢN là có chủ ý: khóa tài khoản thì
       * chính kẻ tấn công lại khóa được người dùng thật ra ngoài — hàng rào thành công cụ
       * phá hoại. Mất phiên thì kẻ tấn công mất cookie, người dùng thật đăng nhập lại là xong.
       */
      const failures = await this.sessions.registerStepUpFailure(session.id);
      const maxFailures = await this.config.getNumber('secretStepUpMaxFailures');
      if (failures >= maxFailures) {
        await this.sessions.revoke(session.id, 'stepup-brute-force');
        await this.audit.append({
          actor: user.email,
          action: 'auth.stepup.session_revoked',
          objectType: 'session',
          objectId: session.id,
          detail: { failures },
        });
        throw new UnauthorizedException({
          code: 'SESSION_REVOKED',
          message: `Gõ sai mã ${failures} lần — phiên đã bị thu hồi. Đăng nhập lại.`,
        });
      }
      throw new UnauthorizedException({
        code: result.reason === 'replayed' ? 'TOTP_REPLAYED' : 'TOTP_INVALID',
        message:
          result.reason === 'replayed'
            ? 'Mã này đã được dùng. Chờ mã mới rồi nhập lại.'
            : 'Mã xác thực không đúng.',
        attemptsLeft: maxFailures - failures,
      });
    }
    await this.sessions.markSteppedUp(session.id);
    await this.users.setTotpLastTimestep(user.id, result.timeStep as number);
  }

  /** Đổi mật khẩu: kiểm mật khẩu cũ, áp luật mạnh, đá mọi phiên khác (NFR-01). */
  async changePassword(
    session: SessionRecord,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.requireUser(session.userId);
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException({
        code: 'CURRENT_PASSWORD_WRONG',
        message: 'Mật khẩu hiện tại không đúng.',
      });
    }
    const check = checkPasswordStrength(newPassword);
    if (!check.ok) {
      throw new BadRequestException({ code: 'PASSWORD_WEAK', message: check.reason });
    }
    if (await this.passwords.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException({
        code: 'PASSWORD_REUSED',
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
      });
    }
    const hash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      await this.users.setPasswordWithin(tx, user.id, hash, false);
      const killed = await this.sessions.revokeAllForUserWithin(
        tx,
        user.id,
        'password-changed',
        session.id,
      );
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.password.changed',
        objectType: 'user',
        objectId: user.id,
        detail: { revokedSessions: killed },
      });
      await this.outbox.enqueueWithin(tx, 'auth.password.changed', { userId: user.id });
    });
  }

  async logout(session: SessionRecord, actorEmail: string): Promise<void> {
    await this.sessions.revoke(session.id, 'logout');
    await this.audit.append({
      actor: actorEmail,
      action: 'auth.logout',
      objectType: 'session',
      objectId: session.id,
    });
  }

  private async requireUser(userId: string): Promise<UserCredentials> {
    const user = await this.users.findCredentialsById(userId);
    if (!user || user.status === 'disabled') {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Phiên không còn hợp lệ. Đăng nhập lại.',
      });
    }
    return user;
  }

  private openTotpSecret(user: UserCredentials): string {
    if (
      !user.totpSecretCt ||
      !user.totpSecretIv ||
      !user.totpSecretTag ||
      !user.totpDekWrapped ||
      user.totpKeyVersion === null
    ) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENROLLED',
        message: 'Tài khoản chưa cài xác thực 2 lớp.',
      });
    }
    return this.envelope.openText(
      {
        ciphertext: user.totpSecretCt,
        iv: user.totpSecretIv,
        tag: user.totpSecretTag,
        wrappedDek: user.totpDekWrapped,
        keyVersion: user.totpKeyVersion,
      },
      { table: TOTP_TABLE, recordId: user.id },
    );
  }

  private async auditFailure(
    user: UserCredentials,
    reason: string,
    ctx: LoginContext,
  ): Promise<void> {
    await this.audit.append({
      actor: user.email,
      action: 'auth.login.failed',
      objectType: 'user',
      objectId: user.id,
      detail: { reason, ip: ctx.ip },
    });
  }

  /** NFR-01: đăng nhập từ thiết bị/trình duyệt mới → email báo chính chủ (qua outbox). */
  private async noticeNewDevice(
    tx: Tx,
    user: UserCredentials,
    ctx: LoginContext,
  ): Promise<void> {
    const hash = createHash('sha256')
      .update(`${ctx.userAgent ?? ''}|${maskIp(ctx.ip)}`)
      .digest('hex');
    const isNew = await this.devices.rememberWithin(tx, user.id, hash, ctx.userAgent);
    if (!isNew) return;
    await this.audit.appendWithin(tx, {
      actor: user.email,
      action: 'auth.device.new',
      objectType: 'user',
      objectId: user.id,
      detail: { ip: ctx.ip },
    });
    await this.outbox.enqueueWithin(tx, 'auth.device.new', { userId: user.id, deviceHash: hash });
  }
}

/** Giữ /24 để đổi IP trong cùng dải LAN không bị coi là thiết bị mới. */
export function maskIp(ip: string | null): string {
  if (!ip) return 'unknown';
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return v4 ? `${v4[1]}.0/24` : ip;
}

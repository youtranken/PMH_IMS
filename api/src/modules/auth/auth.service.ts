import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import type { SealedValue } from '../../common/crypto/envelope.types';
import { AuditWriterService } from '../audit/audit-writer.service';
import { AuditApiService } from '../audit/audit.api';
import { OutboxService } from '../outbox/outbox.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersService } from '../users/users.service';
import type { UserCredentials } from '../users/users.types';
import {
  isLocked,
  lockRemainingSeconds,
  parseBackoffSteps,
  type BackoffPolicy,
  type LockoutState,
} from '../../common/lockout';
import { PasswordService } from './password.service';
import { checkPasswordStrength } from './password-policy';
import { canEnrollWithoutPassword, isStepUpValid } from './session-policy';
import {
  SessionService,
  type CreatedSession,
  type SessionRecord,
  type SessionSummary,
} from './session.service';
import { TotpService } from './totp.service';
import { KnownDeviceService } from './known-device.service';
import { LoginFailureService } from './login-failure.service';

/** AAD của TOTP secret: bảng users + id user (NFR-02). */
const TOTP_TABLE = 'users';
/**
 * AAD của vé cài lại 2 lớp — KHÁC `TOTP_TABLE` để một vé không bao giờ mở được như một secret
 * đang dùng (và ngược lại), và `recordId` gắn cả phiên để vé lọt ra ngoài cũng vô dụng.
 */
const REENROLL_TICKET_TABLE = 'users.totp_reenroll';

/**
 * MỘT câu cho "sai mã" ở cả màn nhập mã lúc đăng nhập lẫn màn cài 2 lớp: nguyên nhân hay gặp
 * nhất là mã đã sang chu kỳ 30 giây mới, nên câu nói luôn cách sửa.
 */
const TOTP_INVALID_MESSAGE =
  'Mã không đúng hoặc đã hết hạn (mã đổi mỗi 30 giây). Hãy nhập mã mới nhất.';

const ALREADY_ENROLLED_MESSAGE =
  'Tài khoản đã bật xác thực 2 lớp. Đổi điện thoại thì vào Hồ sơ của tôi → Xác thực 2 lớp → Cài lại.';

export interface LoginContext {
  ip: string | null;
  userAgent: string | null;
}

export type LoginOutcome =
  | { status: 'authenticated'; session: CreatedSession; mustChangePassword: boolean }
  | { status: 'totp-required'; session: CreatedSession }
  | { status: 'totp-enroll-required'; session: CreatedSession };

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
    private readonly loginFailures: LoginFailureService,
    private readonly probe: AuditApiService,
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
        detail: { reason: 'not-found' },
      });
      throw new UnauthorizedException({
        code: 'LOGIN_FAILED',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    if (user.status === 'disabled') {
      await this.auditFailure(user, 'disabled');
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'Tài khoản đã bị vô hiệu hóa. Liên hệ SA.',
      });
    }

    /*
     * SA KHÓA TAY — kiểm ở đây, tách hẳn khỏi khóa tự động bên dưới.
     *
     * `users.status` có ba giá trị (`active`/`locked`/`disabled`), màn Tài khoản đặt được cả
     * ba. Chỉ kiểm `disabled` thì `locked` rơi thẳng qua: SA bấm "Khóa tài khoản" vì nghi bị
     * chiếm hoặc vì nhân viên vừa nghỉ, màn hiện "Khóa", nhật ký ghi một dòng — và người kia
     * vẫn đăng nhập bình thường. Không có gì trên hệ thống mâu thuẫn với niềm tin rằng đã khóa
     * xong.
     *
     * Nặng thêm: đi tiếp thì bộ đếm sai bị XÓA và nhật ký ghi một lần đăng nhập THÀNH CÔNG
     * cho tài khoản đang bị khóa.
     *
     * Mã lỗi RIÊNG với `ACCOUNT_DISABLED`: khóa là tạm và mở lại được, vô hiệu hóa là dứt
     * điểm. Gộp một mã thì người trực không biết nên bảo người dùng chờ hay bảo họ gặp SA.
     * KHÔNG kèm `retryAfterSeconds` như khóa tự động: khóa này không tự hết, chỉ SA mở.
     */
    if (user.status === 'locked') {
      await this.auditFailure(user, 'locked-by-sa');
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản đang bị khóa. Liên hệ SA để mở lại.',
      });
    }

    const now = new Date();
    /*
     * Hai tầng chặn:
     *   · theo TÀI KHOẢN, chậm dần (SEC-03, Q-06) — thấy kẻ dò đổi IP. Chờ tối đa một bậc cuối
     *     nên người lạ không khoá vĩnh viễn được người dùng thật.
     *   · theo cặp (người dùng, IP) — chặn nơi đang đoán, chặt hơn và nhanh hơn.
     */
    await this.assertAccountNotBackedOff(user, now);
    const lockState = await this.loginFailures.stateFor(user.id, ctx.ip);
    if (isLocked(lockState, now)) return this.rejectIpLocked(user, lockState, now);

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      /*
       * MỘT transaction cho: cộng hai bộ đếm, ghi audit, và (nếu vừa lên bậc chờ) đẩy thư báo
       * vào outbox (AD-5). Tách rời thì bộ đếm có thể đã commit mà thư thì không bao giờ đi.
       */
      const backoff = await this.accountBackoffPolicy();
      await this.db.transaction(async (tx) => {
        // Khoá hàng `users` TRƯỚC hàng theo IP — cùng thứ tự với lượt cấp phiên bên dưới, nếu
        // không hai lượt song song giữ chéo hai khoá và Postgres huỷ một bên vì deadlock.
        await this.registerAccountFailureWithin(tx, user, backoff, now);
        const local = await this.loginFailures.registerFailureWithin(
          tx,
          user.id,
          ctx.ip,
          { maxFailedAttempts: maxFailed, lockoutMinutes },
          now,
        );
        await this.audit.appendWithin(tx, {
          actor: user.email,
          action: 'auth.login.failed',
          objectType: 'user',
          objectId: user.id,
          detail: { reason: 'bad-password', ipLocked: local.lockedUntil !== null },
        });
      });
      throw new UnauthorizedException({
        code: 'LOGIN_FAILED',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    const needsTotp = user.totpLoginRequired;
    const enrolled = user.totpEnrolledAt !== null;

    /*
     * Kiểm lại cả hai tầng khoá SAU KHI giữ hàng `users` (khe L8): cửa đầu đọc ngoài
     * transaction, nên một lượt sai song song có thể đã đẩy tài khoản hoặc cặp (người dùng, IP)
     * lên khoá trong lúc lượt này còn băm Argon2. Lượt sai cũng khoá `users` trước, nên tới đây
     * nó hoặc đã commit (và ta thấy), hoặc phải xếp hàng sau ta.
     */
    type Granted =
      | { blocked: LockoutState; scope: 'account' | 'ip' }
      | { session: CreatedSession };
    const granted = await this.db.transaction(async (tx): Promise<Granted> => {
      const current = await this.users.lockLoginStateWithin(tx, user.id);
      if (isLocked(current, now)) return { blocked: current, scope: 'account' };
      const ipState = await this.loginFailures.stateFor(user.id, ctx.ip, tx);
      if (isLocked(ipState, now)) return { blocked: ipState, scope: 'ip' };
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
        detail: { totpPending: needsTotp },
      });
      /*
       * `last_login_at` chỉ đóng dấu khi phiên đã xác thực ĐỦ.
       *
       * Với `needsTotp` thì tới đây người dùng MỚI qua cửa mật khẩu, chưa vào được — đóng dấu
       * lúc này là ghi một lần đăng nhập chưa từng hoàn tất, và kẻ có mật khẩu nhưng bị chặn ở
       * cửa TOTP sẽ để lại đúng dấu vết của một lần vào bình thường.
       *
       * CÓ BA ĐƯỜNG kết thúc bằng một phiên đã xác thực đủ, không phải hai — rất dễ nghĩ chỉ
       * có "nhánh còn lại" ở đây mà bỏ sót một đường:
       *   1. chính nhánh này, khi tài khoản không bắt TOTP lúc đăng nhập;
       *   2. `verifyLoginTotp` — người đã cài TOTP, gõ mã để vào;
       *   3. `confirmTotpEnrollment` — LẦN ĐẦU, vừa quét QR xong và được cấp phiên ngay.
       * Cả ba đều phải đóng dấu, nếu không thì có người vào thật mà màn Tài khoản vẫn ghi "—".
       */
      if (!needsTotp) await this.users.markLoginCompletedWithin(tx, user.id);
      await this.noticeNewDevice(tx, user, ctx);
      /*
       * Xoá bộ đếm TRONG transaction này, khi còn giữ hàng `users`: xoá sau khi commit thì một
       * lượt sai chen vào giữa bị xoá theo, mất luôn bậc chờ nó vừa gây ra.
       *
       * Bộ đếm theo TÀI KHOẢN chỉ xoá khi đăng nhập TRỌN VẸN. Còn cửa TOTP thì chưa xoá: nếu xoá
       * ở đây, kẻ có mật khẩu lặp "đăng nhập → đoán 5 mã → đăng nhập" mãi mà không lên bậc chờ
       * nào (SEC-02).
       */
      if (!needsTotp) await this.users.clearLoginFailures(user.id, tx);
      /*
       * Bộ đếm theo cặp (người dùng, IP) đếm lượt đoán MẬT KHẨU từ nơi này, và việc đó vừa xong.
       * Cố ý không xoá hàng của IP khác: nơi khác đang dò thì khoá bên đó phải còn nguyên.
       */
      await this.loginFailures.clearFor(user.id, ctx.ip, tx);
      return { session: created };
    });
    if ('blocked' in granted) {
      return granted.scope === 'account'
        ? this.rejectBackedOff(user, granted.blocked, now)
        : this.rejectIpLocked(user, granted.blocked, now);
    }
    const { session } = granted;

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
  ): Promise<{ session: CreatedSession; mustChangePassword: boolean }> {
    /*
     * CHỈ nhận phiên ĐANG CHỜ mã.
     *
     * Đường này kết thúc bằng `completeTotpWithin`, và hàm đó đóng dấu `stepped_up_at` — tức
     * nó cấp một phiên ĐÃ MỞ KÉT. Với một phiên đã xác thực đủ (`totp_pending = false`), gọi
     * lại đường này là một cửa STEP-UP THỨ HAI: cùng tác dụng với `POST /auth/step-up` nhưng
     * không có bộ đếm sai, không thu hồi phiên, và (trước bản sửa này) không có trần riêng.
     */
    if (!session.totpPending) {
      throw new UnauthorizedException({
        code: 'TOTP_NOT_PENDING',
        message: 'Bạn đã đăng nhập xong, không cần nhập mã ở đây. Tải lại trang.',
      });
    }

    const user = await this.requireUser(session.userId);
    const now = new Date();
    // Phiên chờ mở TRƯỚC khi tài khoản lên bậc chờ cũng không được dùng để đoán tiếp.
    await this.assertAccountNotBackedOff(user, now);
    const secret = this.openTotpSecret(user);
    const result = await this.totp.verify({
      token,
      secret,
      lastUsedTimeStep: user.totpLastTimestep,
    });
    if (!result.ok) {
      const backoff = await this.accountBackoffPolicy();
      await this.db.transaction(async (tx) => {
        await this.audit.appendWithin(tx, {
          actor: user.email,
          action: 'auth.totp.failed',
          objectType: 'session',
          objectId: session.id,
          detail: { reason: result.reason },
        });
        // Sai mã TOTP cũng là một lượt đoán vào tài khoản (SEC-02).
        await this.registerAccountFailureWithin(tx, user, backoff, now);
      });
      await this.probe.noteSecurityFailure(user.email);

      /*
       * ĐẾM SAI VÀ THU HỒI PHIÊN — cùng khuôn với `stepUp()`.
       *
       * Chỉ ghi audit rồi ném là không đủ. Trần duy nhất khi đó là throttler chung 300/phút, mà ở route
       * này `req.user` đã tồn tại nên 300 lượt đó đổ hết vào ĐÚNG MỘT tài khoản. Kẻ đã có mật
       * khẩu (dùng lại từ nơi khác, phishing) nhưng không có điện thoại chỉ việc bắn liên tục:
       * phiên chờ không bao giờ chết, `clearLoginFailures` đã xóa bộ đếm nên lockout
       * cũng không liên quan. Đã đo: 25 lượt đoán liên tiếp đều trả 401, không gì chặn.
       *
       * Thu hồi PHIÊN chứ không khóa TÀI KHOẢN — đúng lý do đã viết ở `stepUp()`: khóa tài
       * khoản thì chính kẻ tấn công lại khóa được người dùng thật ra ngoài.
       */
      const failures = await this.sessions.registerStepUpFailure(session.id);
      const maxFailures = await this.config.getNumber('secretStepUpMaxFailures');
      if (failures >= maxFailures) {
        await this.db.transaction(async (tx) => {
          await this.sessions.revokeWithin(tx, session.id, 'totp-brute-force');
          await this.audit.appendWithin(tx, {
            actor: user.email,
            action: 'auth.totp.session_revoked',
            objectType: 'session',
            objectId: session.id,
            detail: { failures },
          });
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
            ? 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.'
            : TOTP_INVALID_MESSAGE,
        attemptsLeft: maxFailures - failures,
      });
    }

    const absoluteHours = await this.config.getNumber('sessionAbsoluteHours');
    const fresh = await this.db.transaction(async (tx) => {
      // Khe L8 ở cửa mã: kiểm lại bậc chờ dưới khoá hàng `users`, như `login()`.
      const current = await this.users.lockLoginStateWithin(tx, user.id);
      if (isLocked(current, now)) await this.rejectBackedOff(user, current, now);
      await this.sessions.revokeWithin(tx, session.id, 'totp-regenerate');
      const created = await this.sessions.createWithin(tx, {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        absoluteHours,
        totpPending: false,
      });
      await this.sessions.completeTotpWithin(tx, created.id);
      /*
       * ĐÂY mới là lúc đóng dấu `last_login_at` cho đường có TOTP.
       *
       * Phiên vừa cấp là phiên đầu tiên người này thật sự vào được: `login()` chỉ mở cửa mật
       * khẩu và cố tình KHÔNG đóng dấu. Đặt trong chính transaction này nên hoặc phiên được
       * cấp VÀ sổ ghi đúng, hoặc không có gì — cùng lý do đã ghi cho lượt đốt mã ngay dưới.
       */
      await this.users.markLoginCompletedWithin(tx, user.id);
      /*
       * ĐỐT MÃ TRONG CÙNG TRANSACTION VỚI LƯỢT CẤP PHIÊN (NFR-01).
       *
       * Ghi mốc này SAU KHI transaction đã commit thì không cần lỗi gì để hỏng: hai
       * request mang CÙNG một mã 6 số, cả hai đọc `totp_last_timestep` cũ, cả hai qua cửa,
       * cả hai được cấp phiên. Một mã ra hai phiên — đúng thứ chống-replay sinh ra để chặn.
       */
      const burned = await this.users.setTotpLastTimestepWithin(
        tx,
        user.id,
        result.timeStep as number,
      );
      /*
       * MÃ ĐÃ BỊ ĐỐT bởi một lượt CHỒNG LÊN lượt này.
       *
       * `totp.verify` phía trên chạy trên ảnh chụp đọc NGOÀI transaction, nên nó không thấy
       * lượt song song. Vị từ trong `setTotpLastTimestepWithin` mới là chỗ loại trừ, và khớp
       * 0 dòng nghĩa là ai đó vừa dùng đúng mã này trước ta trong gang tấc.
       *
       * NÉM để cả transaction rollback: phiên vừa cấp ở trên phải biến mất cùng. Không có
       * dòng này thì lượt thua vẫn được cấp phiên — đúng thứ chống replay sinh ra để chặn.
       */
      if (!burned) {
        throw new UnauthorizedException({
          code: 'TOTP_REPLAYED',
          message: 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.',
        });
      }

      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.login.ok',
        objectType: 'session',
        objectId: created.id,
        detail: { viaTotp: true },
      });
      // Trong transaction, như `login()`: xoá sau commit là xoá luôn lượt sai vừa chen vào.
      await this.users.clearLoginFailures(user.id, tx);
      return created;
    });

    return { session: fresh, mustChangePassword: user.mustChangePassword };
  }

  /** Mốc cài xác thực 2 lớp (null = chưa) — UI dùng để chọn màn enroll hay màn nhập mã. */
  async totpEnrolledAt(userId: string): Promise<Date | null> {
    const user = await this.users.findById(userId);
    return user?.totpEnrolledAt ?? null;
  }

  /**
   * Cửa này có được miễn gõ lại mật khẩu không (A-02).
   *
   * Miễn đúng MỘT trường hợp: phiên còn cờ `totp_pending` VÀ còn trẻ hơn
   * `totp.enroll_reauth_minutes`. Đó là người đang đứng giữa luồng đăng nhập bắt buộc cài
   * 2 lớp — mật khẩu vừa được chứng minh để tạo ra chính phiên này, và phiên đó chưa mở
   * được gì ngoài ba route của luồng đăng nhập.
   *
   * Vì sao phải kèm điều kiện TUỔI: "còn chờ" không tự hết. Bỏ dở giữa chừng rồi để máy mở
   * thì cái cửa ấy đứng đó tới khi phiên hết hạn tuyệt đối — 12 giờ. Hàng rào đo bằng lúc
   * phiên SINH RA, không phải lúc nó được dùng gần nhất: `last_seen_at` bị chính kẻ trộm
   * đẩy tới trước mỗi request, nên dựa vào nó là để đối thủ tự gia hạn cửa cho mình.
   */
  private async enrollNeedsPassword(session: SessionRecord): Promise<boolean> {
    // AD-11: cửa sổ đọc từ `system_config`, không viết cứng. Phép so nằm ở hàm thuần trong
    // `session-policy.ts` — có bài kiểm bảng dữ liệu, cùng chỗ với `isStepUpValid`.
    const minutes = await this.config.getNumber('totpEnrollReauthMinutes');
    return !canEnrollWithoutPassword(session, minutes, new Date());
  }

  /** Enroll TOTP: sinh secret, envelope, trả QR. Chưa bật cho tới khi xác nhận đúng mã. */
  async startTotpEnrollment(
    session: SessionRecord,
    currentPassword: string | undefined,
  ): Promise<{ secret: string; qrDataUrl: string; otpauthUrl: string }> {
    const user = await this.requireUser(session.userId);

    /*
     * Chặn TRƯỚC khi sinh secret, và trước cả câu "đã enroll rồi" bên dưới.
     *
     * Thứ tự này là một phần của hàng rào: hai mã lỗi khác nhau trả về cho hai tình huống
     * khác nhau sẽ nói cho người gọi biết tài khoản kia đã cài 2 lớp hay chưa — một câu
     * mà phiên chưa chứng minh lại mình thì không có quyền hỏi.
     */
    if (await this.enrollNeedsPassword(session)) {
      if (currentPassword === undefined) {
        throw new UnauthorizedException({
          code: 'REAUTH_REQUIRED',
          message: 'Nhập mật khẩu hiện tại để cài xác thực 2 lớp.',
        });
      }
      if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
        await this.failReauth(session, user, {
          failedAction: 'auth.totp.enroll.reauth_failed',
          revokedAction: 'auth.totp.enroll.session_revoked',
          revokeReason: 'enroll-reauth-brute-force',
        });
      }

      /*
       * GÕ ĐÚNG THÌ XOÁ BỘ ĐẾM — nửa còn lại của việc "dùng chung cơ chế cửa két".
       *
       * Thiếu câu này thì bộ đếm chỉ biết cộng: sai bốn lần rồi gõ đúng vẫn để
       * lại `stepup_failures = 4` trên phiên, và lần gõ hụt mã ĐẦU TIÊN ở cửa két sau đó
       * thu hồi phiên, kèm câu "Gõ sai mã 5 lần" nói sai sự thật. Dùng chung bộ đếm thì phải
       * dùng chung cả hai chiều, nếu không "liên tiếp" chỉ là một chữ trong chú thích.
       *
       * `clearStepUpFailuresWithin` chứ không phải `markSteppedUpWithin`: cửa này chứng minh
       * MẬT KHẨU, không chứng minh điện thoại — đóng dấu `stepped_up_at` ở đây là mở cửa két
       * bằng đúng thứ mà cửa két cố ý không nhận.
       */
      await this.db.transaction((tx) => this.sessions.clearStepUpFailuresWithin(tx, session.id));
    }

    if (user.totpEnrolledAt !== null) {
      throw new BadRequestException({
        code: 'TOTP_ALREADY_ENROLLED',
        message: ALREADY_ENROLLED_MESSAGE,
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
    return {
      secret,
      qrDataUrl: await this.totp.qrDataUrl(user.email, secret),
      // Điện thoại không quét được QR trên chính màn hình của nó — link này mở thẳng ứng dụng.
      otpauthUrl: this.totp.keyUri(user.email, secret),
    };
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
  ): Promise<{ session: SessionRecord; newToken: string | null }> {
    const user = await this.requireUser(session.userId);
    // Endpoint này CẤP PHIÊN ĐÃ XÁC THỰC, nên nó phải chặt bằng đúng bước 2 của đăng nhập:
    //  - Đã enroll rồi thì không được vào đây nữa. Nếu không, kẻ có mật khẩu + một mã đã dùng
    //    sẽ đi vòng qua chống-replay của `verifyLoginTotp` (mã bị từ chối ở /login/totp nhưng
    //    lại được chấp nhận ở đây) — và `totp_enrolled_at` bị ghi đè, sai dữ liệu SA nhìn thấy.
    //  - Vẫn phải truyền `totpLastTimestep` để mã đã dùng không dùng lại được.
    if (user.totpEnrolledAt !== null) {
      throw new BadRequestException({
        code: 'TOTP_ALREADY_ENROLLED',
        message: ALREADY_ENROLLED_MESSAGE,
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
            : `${TOTP_INVALID_MESSAGE} Vẫn sai thì kiểm tra giờ trên điện thoại.`,
      });
    }

    const absoluteHours = await this.config.getNumber('sessionAbsoluteHours');
    const fresh = await this.db.transaction(async (tx) => {
      const enrolled = await this.users.markTotpEnrolledWithin(
        tx,
        user.id,
        result.timeStep as number,
      );
      /*
       * Khớp 0 dòng = tài khoản đã enroll xong bởi một lượt chồng lên lượt này. Kiểm
       * `totpEnrolledAt` ở đầu hàm chạy ngoài transaction nên không loại trừ được gì; vị từ
       * `totp_enrolled_at IS NULL` trong câu ghi mới là chỗ loại trừ. Ném để rollback cả phiên
       * vừa cấp — hai lượt cùng thắng nghĩa là secret vừa cài bị ghi đè mốc chống replay.
       */
      if (!enrolled) {
        throw new UnauthorizedException({
          code: 'TOTP_REPLAYED',
          message: 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.',
        });
      }
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.enroll.done',
        objectType: 'user',
        objectId: user.id,
      });
      if (!session.totpPending) return { session, newToken: null };

      await this.sessions.revokeWithin(tx, session.id, 'totp-enroll-regenerate');
      const created = await this.sessions.createWithin(tx, {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        absoluteHours,
        totpPending: false,
      });
      await this.sessions.completeTotpWithin(tx, created.id);
      /*
       * ĐÓNG DẤU Ở ĐÂY LUÔN — đây là đường thứ ba tới một phiên đã xác thực đủ.
       *
       * Dòng `auth.login.ok` ngay dưới đã tự nói rằng đây LÀ một lần đăng nhập thành công.
       * Thiếu dòng này thì hai chỗ nói ngược nhau: nhật ký ghi người ta đã vào, còn cột
       * "Đăng nhập lần cuối" trên màn Tài khoản vẫn là "—". SA rà tài khoản bỏ quên sẽ tin
       * cột hiển thị chứ không đi đọc nhật ký — nên chỗ sai là chỗ người ta tin.
       *
       * Và nó chỉ sai với LẦN ĐẦU của mỗi tài khoản, tức đúng lúc cột đó đáng tin nhất.
       */
      await this.users.markLoginCompletedWithin(tx, user.id);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.login.ok',
        objectType: 'session',
        objectId: created.id,
        detail: { viaTotpEnroll: true },
      });
      await this.users.clearLoginFailures(user.id, tx);
      return { session: created, newToken: created.token };
    });

    return fresh;
  }

  /**
   * FR-022 step-up: gõ TOTP để mở quyền xem secret trong `grace` phút.
   * Luôn bắt buộc, kể cả khi `totp_login_required` tắt.
   */
  async stepUp(session: SessionRecord, token: string): Promise<void> {
    const user = await this.requireUser(session.userId);
    if (user.totpEnrolledAt === null) {
      /*
       * Thông điệp phải CHỈ ĐƯỜNG RA, vì đây là chỗ người dùng kẹt lại.
       *
       * Cửa này canh cả đường GHI vào két, không chỉ đường đọc — nên một câu kiểu "không thể
       * xem bí mật" vừa sai vừa cụt: tài khoản tạo với `totpLoginRequired: false` và chưa
       * enroll bao giờ sẽ gõ mã nào cũng trượt mà không biết phải làm gì tiếp.
       */
      throw new BadRequestException({
        code: 'TOTP_NOT_ENROLLED',
        message:
          'Bạn chưa bật xác thực 2 lớp nên chưa dùng được két. ' +
          'Bật ở Hồ sơ của tôi › Xác thực 2 lớp rồi thử lại.',
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
        action: 'auth.stepup.failed',
        objectType: 'session',
        objectId: session.id,
        detail: { reason: result.reason },
      });
      /* Đếm chung với lượt bị từ chối mở ngăn, và báo cho quản trị khi đủ đáng ngờ. Tách hai
         bộ đếm thì một kẻ khôn ngoan chỉ cần xen kẽ hai kiểu là không chạm ngưỡng nào cả. */
      await this.probe.noteSecurityFailure(user.email);
      /**
       * Sai liên tiếp đủ ngưỡng → THU HỒI PHIÊN.
       *
       * Gõ sai mà chỉ ghi audit thì kẻ cầm cookie phiên trộm được cứ thử mã cho tới khi
       * trúng. Thu hồi PHIÊN chứ không khóa TÀI KHOẢN là có chủ ý: khóa tài khoản thì
       * chính kẻ tấn công lại khóa được người dùng thật ra ngoài — hàng rào thành công cụ
       * phá hoại. Mất phiên thì kẻ tấn công mất cookie, người dùng thật đăng nhập lại là xong.
       */
      const failures = await this.sessions.registerStepUpFailure(session.id);
      const maxFailures = await this.config.getNumber('secretStepUpMaxFailures');
      if (failures >= maxFailures) {
        // Một transaction cho thu-hồi + ghi vết (AD-5, mẫu N3) — cùng khuôn với
        // `verifyLoginTotp` phía trên. Rời ra thì phiên chết mà không ai biết vì sao.
        await this.db.transaction(async (tx) => {
          await this.sessions.revokeWithin(tx, session.id, 'stepup-brute-force');
          await this.audit.appendWithin(tx, {
            actor: user.email,
            action: 'auth.stepup.session_revoked',
            objectType: 'session',
            objectId: session.id,
            detail: { failures },
          });
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
            ? 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.'
            : 'Mã xác thực không đúng.',
        attemptsLeft: maxFailures - failures,
      });
    }
    /*
     * MỘT transaction cho: mở két + ĐỐT MÃ + ghi vết (AD-5, NFR-01).
     *
     * Tách thành ba lượt ghi rời thì hỏng đúng ở chỗ nguy hiểm nhất: audit "auth.stepup.ok"
     * ghi TRƯỚC cả hai lượt còn lại, rồi `markSteppedUp` commit ngay, rồi mới tới mốc
     * chống-replay. Nghĩa là quyền mở két đã cấp xong trong khi mã 6 số vừa dùng VẪN
     * còn hiệu lực tới hết chu kỳ 30 giây — và nếu lượt ghi cuối hỏng thì nó còn hiệu lực mà
     * không có dòng lỗi nào. Sổ cũng nói dối được theo chiều ngược lại: "đã mở két lúc 14:03"
     * trong khi lượt ghi thật đằng sau đã rollback.
     */
    await this.db.transaction(async (tx) => {
      await this.sessions.markSteppedUpWithin(tx, session.id);
      const burned = await this.users.setTotpLastTimestepWithin(
        tx,
        user.id,
        result.timeStep as number,
      );
      /*
       * MÃ ĐÃ BỊ ĐỐT bởi một lượt CHỒNG LÊN lượt này.
       *
       * `totp.verify` phía trên chạy trên ảnh chụp đọc NGOÀI transaction, nên nó không thấy
       * lượt song song. Vị từ trong `setTotpLastTimestepWithin` mới là chỗ loại trừ, và khớp
       * 0 dòng nghĩa là ai đó vừa dùng đúng mã này trước ta trong gang tấc.
       *
       * NÉM để cả transaction rollback: phiên vừa cấp ở trên phải biến mất cùng. Không có
       * dòng này thì lượt thua vẫn được cấp phiên — đúng thứ chống replay sinh ra để chặn.
       */
      if (!burned) {
        throw new UnauthorizedException({
          code: 'TOTP_REPLAYED',
          message: 'Mã này đã được dùng. Chờ mã mới trên ứng dụng rồi nhập lại.',
        });
      }

      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.stepup.ok',
        objectType: 'session',
        objectId: session.id,
      });
    });
  }

  /** Đổi mật khẩu: kiểm mật khẩu cũ, áp luật mạnh, đá mọi phiên khác (NFR-01). */
  async changePassword(
    session: SessionRecord,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.requireUser(session.userId);
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      // SEC-06: cookie bị lộ không được thành chỗ dò mật khẩu hiện tại không giới hạn.
      await this.failReauth(session, user, {
        failedAction: 'auth.password.change_failed',
        revokedAction: 'auth.password.session_revoked',
        revokeReason: 'password-change-brute-force',
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
      // Chứng minh được mật khẩu thì bộ đếm "gõ sai liên tiếp" về 0 (cùng luật với cửa cài TOTP).
      await this.sessions.clearStepUpFailuresWithin(tx, session.id);
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

  /**
   * Cài lại 2 lớp trên điện thoại mới, khi tài khoản ĐANG có 2 lớp (Q-14).
   *
   * Hai điều kiện, cả hai đều ở đây chứ không chỉ ở guard của route:
   *   1. phiên vừa step-up bằng mã HIỆN TẠI (trong ân hạn). Cookie trộm được mà thay được yếu tố
   *      thứ hai là chiếm tài khoản vĩnh viễn — chủ thật mất luôn đường vào, không chỉ mất phiên.
   *   2. mật khẩu hiện tại, như mọi cửa gắn authenticator mới (A-02), chung bộ đếm sai với cửa két.
   *
   * Bước này KHÔNG ghi gì vào `users`: secret mới đi ra dưới dạng một vé mã hoá, gắn chặt với
   * phiên này, và chỉ thay secret thật khi người dùng gõ đúng mã của máy mới. Bỏ dở giữa chừng
   * thì điện thoại cũ vẫn dùng được — ghi đè ngay ở đây là khoá người dùng ra ngoài.
   */
  async startTotpReEnrollment(
    session: SessionRecord,
    currentPassword: string,
  ): Promise<{ secret: string; qrDataUrl: string; otpauthUrl: string; ticket: string }> {
    const graceMinutes = await this.config.getNumber('secretStepUpGraceMinutes');
    if (!isStepUpValid(session.steppedUpAt, graceMinutes, new Date())) {
      throw new UnauthorizedException({
        code: 'STEPUP_REQUIRED',
        message: 'Nhập mã 6 số trên ứng dụng xác thực hiện tại trước khi cài lại.',
        graceMinutes,
      });
    }
    const user = await this.requireUser(session.userId);
    if (user.totpEnrolledAt === null) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENROLLED',
        message: 'Tài khoản chưa bật xác thực 2 lớp — dùng nút Bật ngay.',
      });
    }
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.failReauth(session, user, {
        failedAction: 'auth.totp.reenroll.reauth_failed',
        revokedAction: 'auth.totp.reenroll.session_revoked',
        revokeReason: 'reenroll-reauth-brute-force',
      });
    }

    const secret = this.totp.generateSecret();
    const issuedAt = Date.now();
    const ticket = encodeTicket(
      this.envelope.seal(secret, reenrollContext(user.id, session.id, issuedAt)),
      issuedAt,
    );
    await this.db.transaction(async (tx) => {
      await this.sessions.clearStepUpFailuresWithin(tx, session.id);
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.reenroll.start',
        objectType: 'user',
        objectId: user.id,
      });
    });
    return {
      secret,
      qrDataUrl: await this.totp.qrDataUrl(user.email, secret),
      otpauthUrl: this.totp.keyUri(user.email, secret),
      ticket,
    };
  }

  /**
   * Gõ đúng mã của máy MỚI → thay secret, đốt mã vừa dùng, đóng mọi phiên khác (NFR-01: đổi yếu
   * tố xác thực thì phiên cũ phải chết, như đổi mật khẩu). Phiên hiện tại được giữ để người dùng
   * không bị đá ra ngay sau khi làm đúng.
   */
  async confirmTotpReEnrollment(
    session: SessionRecord,
    ticket: string,
    token: string,
  ): Promise<{ revokedSessions: number }> {
    const user = await this.requireUser(session.userId);
    const secret = await this.openTicket(ticket, user.id, session.id);
    const result = await this.totp.verify({ token, secret, lastUsedTimeStep: null });
    if (!result.ok) {
      await this.audit.append({
        actor: user.email,
        action: 'auth.totp.reenroll.failed',
        objectType: 'user',
        objectId: user.id,
        detail: { reason: result.reason },
      });
      throw new UnauthorizedException({
        code: 'TOTP_INVALID',
        message: 'Mã chưa đúng. Nhập mã đang hiện trên điện thoại MỚI (kiểm tra đồng hồ máy).',
      });
    }

    return this.db.transaction(async (tx) => {
      const sealed = this.envelope.seal(secret, { table: TOTP_TABLE, recordId: user.id });
      const replaced = await this.users.replaceTotpSecretWithin(
        tx,
        user.id,
        sealed,
        result.timeStep as number,
      );
      if (!replaced) {
        throw new BadRequestException({
          code: 'TOTP_NOT_ENROLLED',
          message: 'Xác thực 2 lớp vừa được đặt lại — đăng nhập lại để cài từ đầu.',
        });
      }
      const revokedSessions = await this.sessions.revokeAllForUserWithin(
        tx,
        user.id,
        'totp-reenrolled',
        session.id,
      );
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.reenroll.done',
        objectType: 'user',
        objectId: user.id,
        detail: { revokedSessions },
      });
      await this.outbox.enqueueWithin(tx, 'auth.totp.reenrolled', { userId: user.id });
      return { revokedSessions };
    });
  }

  /** Phiên còn sống của chính người đang gọi, đánh dấu phiên hiện tại. */
  async listOwnSessions(
    session: SessionRecord,
  ): Promise<(SessionSummary & { current: boolean })[]> {
    const idleMinutes = await this.config.getNumber('sessionIdleMinutes');
    const rows = await this.sessions.listAliveForUser(session.userId, idleMinutes);
    return rows.map((row) => ({ ...row, current: row.id === session.id }));
  }

  /**
   * Đóng một phiên KHÁC của chính mình. Phiên của người khác trả cùng mã với phiên không tồn
   * tại — phân biệt hai trường hợp là cho người gọi một cách dò id phiên của người khác.
   */
  async revokeOwnSession(session: SessionRecord, targetId: string): Promise<void> {
    if (targetId === session.id) {
      throw new BadRequestException({
        code: 'SESSION_IS_CURRENT',
        message: 'Đây là phiên bạn đang dùng — bấm Đăng xuất để thoát.',
      });
    }
    const user = await this.requireUser(session.userId);
    await this.db.transaction(async (tx) => {
      const revoked = await this.sessions.revokeOwnWithin(
        tx,
        user.id,
        targetId,
        'revoked-by-owner',
      );
      if (!revoked) {
        throw new NotFoundException({
          code: 'SESSION_NOT_FOUND',
          message: 'Không tìm thấy phiên này (có thể đã đăng xuất).',
        });
      }
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.session.revoked_self',
        objectType: 'session',
        objectId: targetId,
      });
    });
  }

  /** "Đăng xuất các máy khác": mọi phiên của chính mình trừ phiên đang gọi. */
  async revokeOwnOtherSessions(session: SessionRecord): Promise<number> {
    const user = await this.requireUser(session.userId);
    return this.db.transaction(async (tx) => {
      const revokedSessions = await this.sessions.revokeAllForUserWithin(
        tx,
        user.id,
        'revoked-by-owner',
        session.id,
      );
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.session.revoked_others',
        objectType: 'user',
        objectId: user.id,
        detail: { revokedSessions },
      });
      return revokedSessions;
    });
  }

  /**
   * Vé hỏng, bị sửa, quá hạn, hay của phiên/người khác đều ra cùng một câu — không nói hỏng ở đâu.
   *
   * Hạn `totp.enroll_reauth_minutes` tính từ lúc phát: vé không hạn thì một vé lộ ra dùng được suốt
   * đời phiên. `iat` đi dạng rõ nhưng nằm trong ngữ cảnh mã hoá, nên sửa nó là vé không mở được.
   */
  private async openTicket(ticket: string, userId: string, sessionId: string): Promise<string> {
    const minutes = await this.config.getNumber('totpEnrollReauthMinutes');
    try {
      const { sealed, issuedAt } = decodeTicket(ticket);
      const age = Date.now() - issuedAt;
      if (age < 0 || age > minutes * 60_000) throw new Error('ticket');
      return this.envelope.openText(sealed, reenrollContext(userId, sessionId, issuedAt));
    } catch {
      throw new BadRequestException({
        code: 'REENROLL_TICKET_INVALID',
        message: 'Phiên cài lại đã hết hiệu lực. Bấm Cài lại để bắt đầu lại.',
      });
    }
  }

  async logout(session: SessionRecord, actorEmail: string): Promise<void> {
    // Một transaction cho thu-hồi + ghi vết (AD-5, mẫu N3). "Người này đăng xuất lúc mấy giờ,
    // từ đâu" là câu NFR-03 phải trả lời được, và phiên đã chết thì không có lần thử lại nào.
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeWithin(tx, session.id, 'logout');
      await this.audit.appendWithin(tx, {
        actor: actorEmail,
        action: 'auth.logout',
        objectType: 'session',
        objectId: session.id,
      });
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

  /*
   * `ip` không phải tham số ở đây: nó là CỘT `audit_log.ip`, do
   * `AuditWriterService` tự lấy từ ngữ cảnh request (`common/request-context.ts`). Ghi thêm
   * vào `detail` nữa là hai chỗ giữ cùng một sự thật — đúng cách chúng trôi khỏi nhau.
   */
  private async accountBackoffPolicy(): Promise<BackoffPolicy> {
    const [threshold, raw] = await Promise.all([
      this.config.getNumber('loginMaxFailedAttempts'),
      this.config.getString('loginAccountBackoffMinutes'),
    ]);
    return { threshold, stepsMinutes: parseBackoffSteps(raw) };
  }

  /** Tài khoản đang trong bậc chờ (SEC-03) thì từ chối trước khi tốn công băm hay xác minh gì. */
  private async assertAccountNotBackedOff(user: UserCredentials, now: Date): Promise<void> {
    const state = { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil };
    if (!isLocked(state, now)) return;
    await this.rejectBackedOff(user, state, now);
  }

  /** Cặp (người dùng, IP) này đang bị khoá — chặn nơi đang đoán. */
  private async rejectIpLocked(
    user: UserCredentials,
    state: LockoutState,
    now: Date,
  ): Promise<never> {
    const seconds = lockRemainingSeconds(state, now);
    await this.auditFailure(user, 'locked');
    throw new UnauthorizedException({
      code: 'ACCOUNT_LOCKED',
      message: `Tài khoản đang bị khóa. Thử lại sau ${Math.ceil(seconds / 60)} phút.`,
      retryAfterSeconds: seconds,
    });
  }

  private async rejectBackedOff(
    user: UserCredentials,
    state: LockoutState,
    now: Date,
  ): Promise<never> {
    const seconds = lockRemainingSeconds(state, now);
    await this.auditFailure(user, 'account-backoff');
    throw new UnauthorizedException({
      code: 'ACCOUNT_LOCKED',
      message: `Tài khoản đang bị khóa tạm do đăng nhập sai nhiều lần. Thử lại sau ${Math.ceil(seconds / 60)} phút.`,
      retryAfterSeconds: seconds,
    });
  }

  /** Cộng một lượt sai vào tài khoản; vừa lên bậc chờ thì ghi audit và báo chủ tài khoản + SA. */
  private async registerAccountFailureWithin(
    tx: Tx,
    user: UserCredentials,
    policy: BackoffPolicy,
    now: Date,
  ): Promise<void> {
    const state = await this.users.registerLoginFailureWithin(tx, user.id, policy, now);
    if (!state.justLocked) return;
    await this.audit.appendWithin(tx, {
      actor: user.email,
      action: 'auth.account.locked',
      objectType: 'user',
      objectId: user.id,
      detail: { failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil },
    });
    await this.outbox.enqueueWithin(tx, 'auth.account.locked', { userId: user.id });
  }

  /**
   * Gõ sai mật khẩu ở một cửa bắt chứng minh lại (cài TOTP, đổi mật khẩu). Một luật cho mọi cửa:
   * ghi audit, báo probe, cộng bộ đếm DÙNG CHUNG với cửa két (năm lần sai xen kẽ giữa các cửa
   * cũng chết như năm lần ở một cửa), đủ ngưỡng thì thu hồi PHIÊN — không khoá tài khoản, vì khoá
   * tài khoản thì chính kẻ tấn công khoá được người dùng thật. Luôn ném.
   */
  private async failReauth(
    session: SessionRecord,
    user: UserCredentials,
    names: { failedAction: string; revokedAction: string; revokeReason: string },
  ): Promise<never> {
    await this.audit.append({
      actor: user.email,
      action: names.failedAction,
      objectType: 'user',
      objectId: user.id,
      detail: { sessionId: session.id },
    });
    await this.probe.noteSecurityFailure(user.email);
    const failures = await this.sessions.registerStepUpFailure(session.id);
    const maxFailures = await this.config.getNumber('secretStepUpMaxFailures');
    if (failures >= maxFailures) {
      await this.db.transaction(async (tx) => {
        await this.sessions.revokeWithin(tx, session.id, names.revokeReason);
        await this.audit.appendWithin(tx, {
          actor: user.email,
          action: names.revokedAction,
          objectType: 'session',
          objectId: session.id,
          detail: { failures },
        });
      });
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: `Gõ sai mật khẩu ${failures} lần — phiên đã bị thu hồi. Đăng nhập lại.`,
      });
    }
    throw new UnauthorizedException({
      code: 'CURRENT_PASSWORD_WRONG',
      message: 'Mật khẩu hiện tại không đúng.',
      attemptsLeft: maxFailures - failures,
    });
  }

  private async auditFailure(user: UserCredentials, reason: string): Promise<void> {
    await this.audit.append({
      actor: user.email,
      action: 'auth.login.failed',
      objectType: 'user',
      objectId: user.id,
      detail: { reason },
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
      // IP nằm ở cột `audit_log.ip`; `detail` chỉ còn giữ thứ cột không có.
    });
    await this.outbox.enqueueWithin(tx, 'auth.device.new', { userId: user.id, deviceHash: hash });
  }
}

function reenrollContext(userId: string, sessionId: string, issuedAt: number) {
  return { table: REENROLL_TICKET_TABLE, recordId: `${userId}:${sessionId}:${issuedAt}` };
}

function encodeTicket(sealed: SealedValue, issuedAt: number): string {
  const json = JSON.stringify({
    c: sealed.ciphertext.toString('base64'),
    i: sealed.iv.toString('base64'),
    t: sealed.tag.toString('base64'),
    w: sealed.wrappedDek.toString('base64'),
    k: sealed.keyVersion,
    a: issuedAt,
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Ném khi vé không đúng hình dạng — nơi gọi gộp mọi lỗi thành một mã. */
function decodeTicket(ticket: string): { sealed: SealedValue; issuedAt: number } {
  const raw = JSON.parse(Buffer.from(ticket, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const buf = (v: unknown) => {
    if (typeof v !== 'string') throw new Error('ticket');
    return Buffer.from(v, 'base64');
  };
  if (typeof raw.k !== 'number') throw new Error('ticket');
  if (typeof raw.a !== 'number' || !Number.isSafeInteger(raw.a)) throw new Error('ticket');
  return {
    sealed: {
      ciphertext: buf(raw.c),
      iv: buf(raw.i),
      tag: buf(raw.t),
      wrappedDek: buf(raw.w),
      keyVersion: raw.k,
    },
    issuedAt: raw.a,
  };
}

/** Giữ /24 để đổi IP trong cùng dải LAN không bị coi là thiết bị mới. */
function maskIp(ip: string | null): string {
  if (!ip) return 'unknown';
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return v4 ? `${v4[1]}.0/24` : ip;
}

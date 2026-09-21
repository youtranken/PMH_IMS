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
import { AuditApiService } from '../audit/audit.api';
import { OutboxService } from '../outbox/outbox.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersService } from '../users/users.service';
import type { UserCredentials } from '../users/users.types';
import { isLocked, lockRemainingSeconds } from '../../common/lockout';
import { PasswordService } from './password.service';
import { checkPasswordStrength } from './password-policy';
import { canEnrollWithoutPassword } from './session-policy';
import { SessionService, type SessionRecord } from './session.service';
import { TotpService } from './totp.service';
import { KnownDeviceService } from './known-device.service';
import { LoginFailureService } from './login-failure.service';

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
     * ba, nhưng tới 09/09 chỗ này chỉ kiểm `disabled`. `locked` rơi thẳng qua: SA bấm "Khóa
     * tài khoản" vì nghi bị chiếm hoặc vì nhân viên vừa nghỉ, màn hiện "Khóa", nhật ký ghi một
     * dòng — và người kia vẫn đăng nhập bình thường. Không có gì trên hệ thống mâu thuẫn với
     * niềm tin rằng đã khóa xong (rà soát 07/09, mục 6 "Bảo mật").
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
     * KHOÁ TỰ ĐỘNG ĐỌC THEO CẶP (NGƯỜI DÙNG, IP) — đổi 11/09.
     *
     * Bản trước đọc `users.failed_attempts`/`users.locked_until`, tức khoá đặt lên TÀI KHOẢN.
     * Hệ quả không ai định: cái khoá đó ai kích cũng được. Biết email của một người là khoá
     * được họ ra ngoài bằng năm request, lặp lại tuỳ thích — và người đáng khoá nhất là SA,
     * đúng lúc đang có sự cố cần đăng nhập để xử lý.
     *
     * Khoá sinh ra để chặn một người đang ĐOÁN, mà người đoán thì ngồi ở một chỗ. Chặn đúng
     * chỗ đó là đủ; người dùng thật ngồi ở bàn của họ không việc gì phải chịu hậu quả.
     *
     * Xem `0045_login_failure_per_ip.sql` để biết vì sao KHÔNG thêm một trần chặn ở tầng tài
     * khoản, kể cả ở mức cao.
     */
    const lockState = await this.loginFailures.stateFor(user.id, ctx.ip);
    if (isLocked(lockState, now)) {
      const seconds = lockRemainingSeconds(lockState, now);
      await this.auditFailure(user, 'locked');
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: `Tài khoản đang bị khóa. Thử lại sau ${Math.ceil(seconds / 60)} phút.`,
        retryAfterSeconds: seconds,
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      /*
       * MỘT transaction cho cả ba việc: cộng bộ đếm, ghi audit, và (nếu vừa khóa) đẩy email
       * báo SA vào outbox.
       *
       * Bản trước làm ba bước rời: `applyLockoutState` chạy trên pool và COMMIT NGAY, rồi mới
       * mở một transaction khác cho audit + outbox. Hai lỗi cộng dồn:
       *
       * 1. ĐUA (finding #5). Bộ đếm là đọc-rồi-ghi-đè quanh một lần Argon2 ~200ms, nên N lượt
       *    đoán song song chỉ tốn 1 lượt đếm. Nay `registerLoginFailureWithin` cộng nguyên tử
       *    ngay trong câu UPDATE.
       * 2. MẤT EMAIL (mẫu N3). `locked_until` đã commit mà transaction thứ hai hỏng — pool
       *    cạn, worker bị kill — thì tài khoản BỊ KHÓA nhưng SA không bao giờ nhận được thư,
       *    và không có đường bù: lần thử sau bị `isLocked()` chặn ở trên nên `justLocked`
       *    không bao giờ đúng lần nữa.
       */
      await this.db.transaction(async (tx) => {
        const policy = { maxFailedAttempts: maxFailed, lockoutMinutes };
        /*
         * HAI BỘ ĐẾM, HAI VAI KHÁC HẲN NHAU (11/09):
         *
         *   · theo CẶP (người dùng, IP) — bộ đếm CHẶN. Đây là thứ quyết định lượt sau có vào
         *     được không.
         *   · trên hàng `users` — bộ đếm CẢNH BÁO. Nó không chặn ai nữa, nhưng là chỗ DUY NHẤT
         *     nhìn thấy bức tranh "tài khoản này đang bị dò từ nhiều nơi": bộ đếm theo cặp,
         *     chia nhỏ theo IP, không bao giờ thấy điều đó.
         *
         * Vẫn dùng chung `registerFailure` của `common/lockout.ts` cho cả hai, nên luật (ngưỡng,
         * "khoá hết hạn thì đếm lại từ 0", `justLocked`) chỉ có MỘT bản.
         */
        const local = await this.loginFailures.registerFailureWithin(
          tx,
          user.id,
          ctx.ip,
          policy,
          now,
        );
        const state = await this.users.registerLoginFailureWithin(tx, user.id, policy, now);
        await this.audit.appendWithin(tx, {
          actor: user.email,
          action: 'auth.login.failed',
          objectType: 'user',
          objectId: user.id,
          detail: { reason: 'bad-password', ipLocked: local.lockedUntil !== null },
        });
        /*
         * `justLocked` nay đọc là "VỪA CHẠM NGƯỠNG CẢNH BÁO", không còn là "vừa bị khoá".
         *
         * Tên cờ và tên mã audit (`auth.account.locked`) giữ nguyên có chủ ý: đổi chúng là
         * làm gãy mọi truy vấn nhật ký đã viết và mọi bài kiểm đang chốt chúng, đổi lấy một
         * chữ đẹp hơn. Chỗ PHẢI đổi là thứ người ta ĐỌC — nội dung lá thư gửi SA, xem
         * `mail.consumer.ts`. `users.locked_until` vẫn được ghi, nay với vai CỬA SỔ CHỐNG SPAM
         * THƯ: không báo lại cho tới khi nó qua.
         */
        if (state.justLocked) {
          await this.audit.appendWithin(tx, {
            actor: user.email,
            action: 'auth.account.locked',
            objectType: 'user',
            objectId: user.id,
            detail: { failedAttempts: state.failedAttempts },
          });
          // Email báo SA đi qua outbox (AD-5) — không gửi thẳng trong request.
          await this.outbox.enqueueWithin(tx, 'auth.account.locked', { userId: user.id });
        }
        return state;
      });
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
        detail: { totpPending: needsTotp },
      });
      /*
       * `last_login_at` chỉ đóng dấu khi phiên đã xác thực ĐỦ (11/09).
       *
       * Với `needsTotp` thì tới đây người dùng MỚI qua cửa mật khẩu, chưa vào được — đóng dấu
       * lúc này là ghi một lần đăng nhập chưa từng hoàn tất, và kẻ có mật khẩu nhưng bị chặn ở
       * cửa TOTP sẽ để lại đúng dấu vết của một lần vào bình thường.
       *
       * CÓ BA ĐƯỜNG kết thúc bằng một phiên đã xác thực đủ, không phải hai — bản đầu viết
       * "nhánh còn lại" ở đây và bỏ sót mất một đường (test tay 12/09):
       *   1. chính nhánh này, khi tài khoản không bắt TOTP lúc đăng nhập;
       *   2. `verifyLoginTotp` — người đã cài TOTP, gõ mã để vào;
       *   3. `confirmTotpEnrollment` — LẦN ĐẦU, vừa quét QR xong và được cấp phiên ngay.
       * Cả ba đều phải đóng dấu, nếu không thì có người vào thật mà màn Tài khoản vẫn ghi "—".
       */
      if (!needsTotp) await this.users.markLoginCompletedWithin(tx, user.id);
      await this.noticeNewDevice(tx, user, ctx);
      return created;
    });

    // Mật khẩu đã đúng → xoá dấu vết ĐOÁN MẬT KHẨU. Việc này đúng ở đây kể cả khi còn cửa TOTP:
    // hai bộ đếm đó đếm lượt đoán mật khẩu, mà việc đó vừa kết thúc.
    await this.users.clearLoginFailures(user.id);
    /*
     * Vào được từ NƠI NÀY → xoá dấu vết của chính nơi này.
     *
     * Cố ý không xoá hàng của IP khác: nếu có ai đang dò tài khoản này từ chỗ khác thì khoá
     * bên đó phải còn nguyên. Người dùng thật đăng nhập được không phải là bằng chứng rằng kẻ
     * kia đã thôi gõ.
     */
    await this.loginFailures.clearFor(user.id, ctx.ip);

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
    /*
     * CHỈ nhận phiên ĐANG CHỜ mã. Bản trước không kiểm gì cả.
     *
     * Đường này kết thúc bằng `completeTotpWithin`, và hàm đó đóng dấu `stepped_up_at` — tức
     * nó cấp một phiên ĐÃ MỞ KÉT. Với một phiên đã xác thực đủ (`totp_pending = false`), gọi
     * lại đường này là một cửa STEP-UP THỨ HAI: cùng tác dụng với `POST /auth/step-up` nhưng
     * không có bộ đếm sai, không thu hồi phiên, và (trước bản sửa này) không có trần riêng.
     */
    if (!session.totpPending) {
      throw new UnauthorizedException({
        code: 'TOTP_NOT_PENDING',
        message: 'Phiên này không ở bước chờ mã. Dùng đường mở két nếu cần xác thực lại.',
      });
    }

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
        detail: { reason: result.reason },
      });

      /*
       * ĐẾM SAI VÀ THU HỒI PHIÊN — cùng khuôn với `stepUp()` (finding #2).
       *
       * Bản trước chỉ ghi audit rồi ném. Trần duy nhất là throttler chung 300/phút, mà ở route
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
            : 'Mã xác thực không đúng.',
        attemptsLeft: maxFailures - failures,
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
      /*
       * ĐÂY mới là lúc đóng dấu `last_login_at` cho đường có TOTP (11/09).
       *
       * Phiên vừa cấp là phiên đầu tiên người này thật sự vào được: `login()` chỉ mở cửa mật
       * khẩu và cố tình KHÔNG đóng dấu. Đặt trong chính transaction này nên hoặc phiên được
       * cấp VÀ sổ ghi đúng, hoặc không có gì — cùng lý do đã ghi cho lượt đốt mã ngay dưới.
       */
      await this.users.markLoginCompletedWithin(tx, user.id);
      /*
       * ĐỐT MÃ TRONG CÙNG TRANSACTION VỚI LƯỢT CẤP PHIÊN (NFR-01).
       *
       * Bản trước ghi mốc này SAU KHI transaction đã commit. Không cần lỗi gì để hỏng: hai
       * request mang CÙNG một mã 6 số, cả hai đọc `totp_last_timestep` cũ, cả hai qua cửa,
       * cả hai được cấp phiên. Một mã ra hai phiên — đúng thứ chống-replay sinh ra để chặn.
       */
      const burned = await this.users.setTotpLastTimestepWithin(
        tx,
        user.id,
        result.timeStep as number,
      );
      /*
       * MÃ ĐÃ BỊ ĐỐT bởi một lượt CHỒNG LÊN lượt này (rà soát 10/09).
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
      return created;
    });

    return { session: fresh, mustChangePassword: user.mustChangePassword };
  }

  /** Đã cài xác thực 2 lớp chưa — UI dùng để chọn màn enroll hay màn nhập mã. */
  async isTotpEnrolled(userId: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    return user?.totpEnrolledAt !== null && user !== null;
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
  ): Promise<{ secret: string; qrDataUrl: string }> {
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
        await this.audit.append({
          actor: user.email,
          action: 'auth.totp.enroll.reauth_failed',
          objectType: 'user',
          objectId: user.id,
          detail: { sessionId: session.id },
        });
        /* Đếm chung với lượt gõ sai mã ở cửa két: cửa này dẫn thẳng tới step-up, và một người
           đang đoán mật khẩu ở đây là dấu hiệu rõ nhất rằng có cookie đang ở nhầm tay. */
        await this.probe.noteSecurityFailure(user.email);

        /*
         * ĐOÁN ĐỦ NGƯỠNG THÌ MẤT PHIÊN — dùng lại NGUYÊN cơ chế của cửa két, cả bộ đếm lẫn
         * ngưỡng (`secret.stepup_max_failures`).
         *
         * Vì sao không phải một trần theo phút: trần theo phút cho kẻ tấn công thử lại MÃI,
         * chỉ chậm hơn — 10 lượt/phút vẫn là mười bốn nghìn lần đoán mỗi ngày. Thu hồi phiên
         * thì cái cookie trộm được CHẾT sau năm lần, và muốn có cookie mới thì phải có... mật
         * khẩu. Hàng rào chặn đúng thứ nó định chặn thay vì làm nó chậm đi.
         *
         * Và đây là lý do bộ đếm dùng CHUNG với cửa két chứ không dựng bộ thứ hai: hai cửa
         * hỏi cùng một câu ("chứng minh lại đi"), nên năm lần sai ở hai cửa xen kẽ cũng phải
         * chết y như năm lần sai ở một cửa.
         *
         * Thu hồi PHIÊN chứ không khóa TÀI KHOẢN, cùng lý do đã ghi ở `stepUp`: khóa tài
         * khoản thì chính kẻ tấn công lại khóa được người dùng thật ra ngoài.
         */
        const failures = await this.sessions.registerStepUpFailure(session.id);
        const maxFailures = await this.config.getNumber('secretStepUpMaxFailures');
        if (failures >= maxFailures) {
          await this.db.transaction(async (tx) => {
            await this.sessions.revokeWithin(tx, session.id, 'enroll-reauth-brute-force');
            await this.audit.appendWithin(tx, {
              actor: user.email,
              action: 'auth.totp.enroll.session_revoked',
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

      /*
       * GÕ ĐÚNG THÌ XOÁ BỘ ĐẾM — nửa còn lại của việc "dùng chung cơ chế cửa két".
       *
       * Thiếu câu này (tới 21/09) thì bộ đếm chỉ biết cộng: sai bốn lần rồi gõ đúng vẫn để
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
      /*
       * ĐÓNG DẤU Ở ĐÂY LUÔN — đây là đường thứ ba tới một phiên đã xác thực đủ (vá 12/09).
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
      /*
       * Thông điệp phải CHỈ ĐƯỜNG RA, vì đây là chỗ người dùng kẹt lại.
       *
       * Từ 08/09 cửa này canh cả đường GHI vào két (C2), không chỉ đường đọc — nên câu cũ
       * ("không thể xem bí mật") vừa sai vừa cụt: tài khoản tạo với `totpLoginRequired: false`
       * và chưa enroll bao giờ sẽ gõ mã nào cũng trượt mà không biết phải làm gì tiếp
       * (rà soát 08/09, #4).
       */
      throw new BadRequestException({
        code: 'TOTP_NOT_ENROLLED',
        message:
          'Chưa bật xác thực 2 lớp nên không mở được két (kể cả để ghi). ' +
          'Vào Hồ sơ của bạn để bật xác thực 2 lớp, rồi thử lại.',
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
            ? 'Mã này đã được dùng. Chờ mã mới rồi nhập lại.'
            : 'Mã xác thực không đúng.',
        attemptsLeft: maxFailures - failures,
      });
    }
    /*
     * MỘT transaction cho: mở két + ĐỐT MÃ + ghi vết (AD-5, NFR-01).
     *
     * Bản trước là ba lượt ghi rời, và thứ tự của chúng sai đúng ở chỗ nguy hiểm nhất: audit
     * "auth.stepup.ok" ghi TRƯỚC cả hai lượt còn lại, rồi `markSteppedUp` commit ngay, rồi mới
     * tới mốc chống-replay. Nghĩa là quyền mở két đã cấp xong trong khi mã 6 số vừa dùng VẪN
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
       * MÃ ĐÃ BỊ ĐỐT bởi một lượt CHỒNG LÊN lượt này (rà soát 10/09).
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
   * `ip` không còn là tham số ở đây: từ 08/09 nó là CỘT `audit_log.ip`, do
   * `AuditWriterService` tự lấy từ ngữ cảnh request (`common/request-context.ts`). Ghi thêm
   * vào `detail` nữa là hai chỗ giữ cùng một sự thật — đúng cách chúng trôi khỏi nhau.
   */
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

/** Giữ /24 để đổi IP trong cùng dải LAN không bị coi là thiết bị mới. */
export function maskIp(ip: string | null): string {
  if (!ip) return 'unknown';
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return v4 ? `${v4[1]}.0/24` : ip;
}

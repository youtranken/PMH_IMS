import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PASSWORD_PENDING_KEY } from './password-pending.decorator';
import { ALLOW_TOTP_PENDING_KEY } from './totp-pending.decorator';
import { NO_IDLE_TOUCH_KEY } from './no-idle-touch.decorator';
import { evaluateSession, isTotpChallengeExpired } from './session-policy';
import { SessionService } from './session.service';
import { SESSION_COOKIE } from './cookie';
import { isTempPasswordExpired, TEMP_PASSWORD_EXPIRED_MESSAGE } from './temp-password-policy';
import type { AuthedRequest } from './types';

/**
 * Xác thực bằng cookie phiên (AD-8). Mọi quyết định đọc DB mỗi request:
 * SA đá phiên hoặc khóa user là có hiệu lực NGAY, không chờ token hết hạn.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly config: SystemConfigService,
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw unauthorized('SESSION_MISSING', 'Chưa đăng nhập.');

    const session = await this.sessions.findByToken(token);
    if (!session) throw unauthorized('SESSION_MISSING', 'Phiên không tồn tại. Đăng nhập lại.');

    const idleMinutes = await this.config.getNumber('sessionIdleMinutes');
    const verdict = evaluateSession(session, idleMinutes, new Date());
    if (verdict !== 'alive') {
      throw unauthorized(
        verdict === 'revoked' ? 'SESSION_REVOKED' : 'SESSION_EXPIRED',
        verdict === 'revoked'
          ? 'Phiên đã bị thu hồi. Đăng nhập lại.'
          : 'Phiên đã hết hạn. Đăng nhập lại.',
      );
    }

    const user = await this.users.findById(session.userId);

    // Đúng mật khẩu nhưng chưa qua TOTP: chỉ vài route được phép (nhập mã / enroll / logout).
    if (session.totpPending) {
      if (user) await this.rejectStaleTotpChallenge(session, user);
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_PENDING_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw unauthorized('TOTP_REQUIRED', 'Cần nhập mã xác thực 2 lớp để tiếp tục.');
      }
    }

    if (!user) throw unauthorized('SESSION_INVALID', 'Tài khoản không còn tồn tại.');
    if (user.status !== 'active') {
      throw unauthorized('ACCOUNT_DISABLED', 'Tài khoản đã bị khóa hoặc vô hiệu hóa.');
    }

    // Kể cả ở cửa đổi mật khẩu: phiên mở bằng mật khẩu tạm không được sống lâu hơn mật khẩu đó.
    if (isTempPasswordExpired(user, new Date())) await this.rejectExpiredTempPassword(session.id, user);

    /*
     * ĐANG BỊ BẮT ĐỔI MẬT KHẨU thì chỉ đi được bốn cửa.
     *
     * `must_change_password` mặc định `true` cho mọi tài khoản mới và mọi lần SA reset. Không
     * có khối này thì ràng buộc duy nhất nằm ở `nextStepPath()` bên web, tức mật khẩu tạm (đi
     * qua email, hoặc đọc qua điện thoại, và nằm nguyên trong response của `POST /accounts`)
     * dùng được vô thời hạn nếu gọi API thẳng.
     *
     * Đặt SAU `status !== 'active'` và SAU khối `totpPending`: thứ tự này là thứ tự của luồng
     * đăng nhập, nên câu lỗi người dùng nhận luôn là bước còn thiếu GẦN NHẤT, không phải bước
     * xa nhất. Cùng khuôn danh-sách-trắng với `@AllowTotpPending()` ngay trên.
     */
    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_PENDING_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException({
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Phải đổi mật khẩu tạm trước khi dùng tiếp.',
        });
      }
    }

    request.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sessionId: session.id,
      steppedUpAt: session.steppedUpAt,
      mustChangePassword: user.mustChangePassword,
    };

    // Gia hạn idle. Bỏ qua lỗi để một lần ghi hỏng không chặn cả request đọc.
    // Vòng hỏi định kỳ (`@NoIdleTouch()`) không phải thao tác của người: gia hạn ở đó thì tab bỏ
    // mở không bao giờ hết idle (NFR-01).
    const noTouch = this.reflector.getAllAndOverride<boolean>(NO_IDLE_TOUCH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!noTouch) void this.sessions.touch(session.id).catch(() => undefined);
    return true;
  }

  /**
   * Phiên chờ nhập mã quá `auth.totp_challenge_minutes` (Q-20): thu hồi + nhật ký trong một
   * transaction (AD-5), rồi 401. Kể cả ở route được phép khi chờ mã — đó chính là cửa cần đóng.
   *
   * Thu hồi chứ không chỉ từ chối: phiên ấy không bao giờ sống lại được, để nó nằm trong danh
   * sách phiên tới khi hết idle chỉ làm người dùng tưởng còn một máy đang đăng nhập.
   * `reason` để web nói "Hết thời gian nhập mã" thay vì câu hết phiên chung chung.
   */
  private async rejectStaleTotpChallenge(
    session: { id: string; totpPending: boolean; createdAt: Date },
    user: { email: string; totpEnrolledAt: Date | null },
  ): Promise<void> {
    const minutes = await this.config.getNumber('authTotpChallengeMinutes');
    if (!isTotpChallengeExpired(session, user.totpEnrolledAt !== null, minutes, new Date())) return;
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeWithin(tx, session.id, 'totp-challenge-expired');
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.totp.challenge_expired',
        objectType: 'session',
        objectId: session.id,
        detail: { minutes },
      });
    });
    throw new UnauthorizedException({
      code: 'SESSION_EXPIRED',
      reason: 'TOTP_CHALLENGE_EXPIRED',
      message: 'Hết thời gian nhập mã. Đăng nhập lại.',
    });
  }

  /**
   * Phiên đang chờ đổi mật khẩu mà mật khẩu tạm đã quá `auth.temp_password_hours` (Q-20): thu
   * hồi + nhật ký trong một transaction (AD-5), rồi 401. Không thu hồi thì người cầm phiên vẫn
   * đổi được mật khẩu bằng chính mật khẩu tạm đã hết hạn — đúng thứ hạn này phải chặn.
   */
  private async rejectExpiredTempPassword(
    sessionId: string,
    user: { email: string; tempPasswordExpiresAt: Date | null },
  ): Promise<never> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeWithin(tx, sessionId, 'temp-password-expired');
      await this.audit.appendWithin(tx, {
        actor: user.email,
        action: 'auth.temp_password.expired',
        objectType: 'session',
        objectId: sessionId,
        detail: { expiredAt: user.tempPasswordExpiresAt?.toISOString() ?? null },
      });
    });
    throw new UnauthorizedException({
      code: 'SESSION_EXPIRED',
      reason: 'TEMP_PASSWORD_EXPIRED',
      message: TEMP_PASSWORD_EXPIRED_MESSAGE,
    });
  }
}

function unauthorized(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}

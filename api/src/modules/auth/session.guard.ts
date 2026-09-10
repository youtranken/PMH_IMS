import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersService } from '../users/users.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PASSWORD_PENDING_KEY } from './password-pending.decorator';
import { ALLOW_TOTP_PENDING_KEY } from './totp-pending.decorator';
import { evaluateSession } from './session-policy';
import { SessionService } from './session.service';
import { SESSION_COOKIE } from './cookie';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const sessionId = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!sessionId) throw unauthorized('SESSION_MISSING', 'Chưa đăng nhập.');

    const session = await this.sessions.find(sessionId);
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

    // Đúng mật khẩu nhưng chưa qua TOTP: chỉ vài route được phép (nhập mã / enroll / logout).
    if (session.totpPending) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_PENDING_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw unauthorized('TOTP_REQUIRED', 'Cần nhập mã xác thực 2 lớp để tiếp tục.');
      }
    }

    const user = await this.users.findById(session.userId);
    if (!user) throw unauthorized('SESSION_INVALID', 'Tài khoản không còn tồn tại.');
    if (user.status !== 'active') {
      throw unauthorized('ACCOUNT_DISABLED', 'Tài khoản đã bị khóa hoặc vô hiệu hóa.');
    }

    /*
     * ĐANG BỊ BẮT ĐỔI MẬT KHẨU thì chỉ đi được bốn cửa (rà soát 10/09).
     *
     * `must_change_password` mặc định `true` cho mọi tài khoản mới và mọi lần SA reset. Tới
     * 10/09 nó chỉ được ĐỌC và trả về client — không guard nào chặn. Ràng buộc duy nhất nằm ở
     * `nextStepPath()` bên web, tức mật khẩu tạm (đi qua email, hoặc đọc qua điện thoại, và
     * nằm nguyên trong response của `POST /accounts`) dùng được vô thời hạn nếu gọi API thẳng.
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
    void this.sessions.touch(session.id).catch(() => undefined);
    return true;
  }
}

function unauthorized(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { SessionService } from './session.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthedRequest } from './types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Hai lớp chống CSRF (AD-8) — KHÔNG dùng thư viện csrf-csrf:
 *  1. Header `X-CSRF-Token` phải khớp `sessions.csrf_token` (so sánh timing-safe).
 *  2. Header `Origin` phải đúng APP_BASE_URL — chặn cả trường hợp token rò qua XSS ở site khác.
 *
 * Chạy SAU SessionGuard (đã có request.user.sessionId).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!MUTATING_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    this.assertOrigin(request);

    // Route công khai (đăng nhập) chưa có phiên → chỉ kiểm Origin là đủ.
    if (isPublic) return true;

    const sessionId = request.user?.sessionId;
    if (!sessionId) {
      throw new ForbiddenException({
        code: 'CSRF_NO_SESSION',
        message: 'Phiên không còn hợp lệ. Đăng nhập lại.',
      });
    }

    const token = request.headers['x-csrf-token'];
    if (typeof token === 'string' && token.length > 0) {
      const session = await this.sessions.find(sessionId);
      if (session && tokensMatch(session.csrfToken, token)) return true;
    }
    throw new ForbiddenException({
      code: 'CSRF_TOKEN_INVALID',
      message: 'Trang đã cũ so với phiên đăng nhập. Tải lại trang rồi thử lại.',
    });
  }

  private assertOrigin(request: AuthedRequest): void {
    const expected = process.env.APP_BASE_URL;
    if (!expected) return; // đã fail-fast lúc boot; ở test thì bỏ qua
    const origin = request.headers.origin;
    if (!origin) return; // client cùng gốc có thể không gửi Origin ở một số trình duyệt cũ
    if (normalize(origin) !== normalize(expected)) {
      throw new ForbiddenException({
        code: 'ORIGIN_MISMATCH',
        message: 'Yêu cầu đến từ nguồn không hợp lệ.',
      });
    }
  }
}

function normalize(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

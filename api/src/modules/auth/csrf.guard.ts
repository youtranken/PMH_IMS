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
 *  2. Nguồn của request phải là APP_BASE_URL — chặn cả trường hợp token rò qua XSS ở site khác.
 *     Nguồn đọc theo thứ tự `Origin` → `Sec-Fetch-Site` → `Referer`: trình duyệt hiện đại luôn gửi
 *     `Origin` cho POST, hai header sau là dự phòng cho client không gửi nó.
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

    this.assertOrigin(request, isPublic === true);

    // Route công khai (đăng nhập) chưa có phiên → chỉ kiểm nguồn là đủ.
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

  private assertOrigin(request: AuthedRequest, isPublic: boolean): void {
    const expected = process.env.APP_BASE_URL;
    if (!expected) return; // đã fail-fast lúc boot; ở test thì bỏ qua
    const source = sourceOf(request);
    if (source === 'missing') {
      // Route cần phiên còn lớp token đứng sau. Route công khai (đăng nhập) thì lớp nguồn là lớp
      // DUY NHẤT: cho qua ở đây là mở login-CSRF (SEC-11) — kẻ tấn công đăng nhập nạn nhân vào
      // tài khoản của hắn để hứng thứ nạn nhân nhập sau đó.
      if (!isPublic) return;
      throw new ForbiddenException({
        code: 'ORIGIN_MISSING',
        message: 'Yêu cầu đến từ nguồn không hợp lệ.',
      });
    }
    if (source === 'same-origin') return;
    if (source === 'cross' || normalize(source) !== normalize(expected)) {
      throw new ForbiddenException({
        code: 'ORIGIN_MISMATCH',
        message: 'Yêu cầu đến từ nguồn không hợp lệ.',
      });
    }
  }
}

/**
 * Trả về origin cần so với APP_BASE_URL, hoặc một kết luận đã chắc:
 * `same-origin` (trình duyệt tự khẳng định), `cross` (khẳng định khác gốc / header hỏng),
 * `missing` (không có tín hiệu nào).
 */
function sourceOf(request: AuthedRequest): string {
  const origin = header(request, 'origin');
  // `Origin: null` (iframe sandbox, file://) là tín hiệu có mặt, không phải thiếu.
  if (origin !== undefined) return origin;

  const site = header(request, 'sec-fetch-site');
  if (site !== undefined) {
    // `none` = người dùng tự gõ/bấm bookmark, không có trang nào khởi xướng.
    // `same-site` vẫn chặn: subdomain khác của pmh.com.vn không phải chính ứng dụng.
    return site === 'same-origin' || site === 'none' ? 'same-origin' : 'cross';
  }

  const referer = header(request, 'referer');
  if (referer !== undefined) {
    try {
      return new URL(referer).origin;
    } catch {
      return 'cross';
    }
  }
  return 'missing';
}

function header(request: AuthedRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.length > 0 ? first : undefined;
}

function normalize(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

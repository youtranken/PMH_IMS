import type { CookieOptions, Response } from 'express';

export const SESSION_COOKIE = 'ims_session';

/**
 * Cookie phiên (NFR-01): httpOnly + Secure + SameSite=Strict.
 * Không đặt `maxAge` — cookie phiên trình duyệt; tuổi thọ THẬT do DB quyết (idle/absolute),
 * để SA đá phiên là chết ngay chứ không phụ thuộc đồng hồ máy khách.
 */
function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Dev chạy http://localhost thì Secure sẽ chặn cookie — chỉ tắt khi NODE_ENV=development.
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/',
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

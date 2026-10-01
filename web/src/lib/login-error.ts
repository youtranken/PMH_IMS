import { ApiError } from '@/lib/api-client';

export type LoginErrorKind = 'wrong' | 'wait' | 'locked' | 'disabled' | 'tempExpired' | 'other';

/**
 * Nguyên nhân một lượt đăng nhập hỏng → việc màn đăng nhập phải làm.
 *
 * `ACCOUNT_LOCKED` mang hai nghĩa ở API: kèm `retryAfterSeconds` là khoá TỰ ĐỘNG do gõ sai
 * (tự hết, chỉ cần chờ); không kèm là QUẢN TRỊ khoá tay (không tự hết, phải gặp người mở). Hai
 * cảnh đó cần hai lời khuyên ngược nhau, nên tách ở đây chứ không để màn tự đọc message.
 *
 * `clearPassword` chỉ đúng khi mật khẩu thật sự sai: lỗi mạng hay 5xx thì người dùng không gõ
 * sai gì, xoá ô là bắt họ gõ lại 12+ ký tự vô cớ.
 */
export function classifyLoginError(error: unknown): {
  kind: LoginErrorKind;
  retryAfterSeconds: number | null;
  clearPassword: boolean;
} {
  if (!(error instanceof ApiError)) return { kind: 'other', retryAfterSeconds: null, clearPassword: false };
  const body = error.body as { code?: string; retryAfterSeconds?: unknown } | null;
  switch (body?.code) {
    case 'LOGIN_FAILED':
      return { kind: 'wrong', retryAfterSeconds: null, clearPassword: true };
    case 'ACCOUNT_LOCKED': {
      const seconds = body.retryAfterSeconds;
      return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? { kind: 'wait', retryAfterSeconds: Math.ceil(seconds), clearPassword: false }
        : { kind: 'locked', retryAfterSeconds: null, clearPassword: false };
    }
    case 'ACCOUNT_DISABLED':
      return { kind: 'disabled', retryAfterSeconds: null, clearPassword: false };
    // Mật khẩu tạm đúng nhưng quá hạn (Q-20): gõ lại không giúp gì, chỉ SA đặt lại được.
    case 'TEMP_PASSWORD_EXPIRED':
      return { kind: 'tempExpired', retryAfterSeconds: null, clearPassword: false };
    default:
      return { kind: 'other', retryAfterSeconds: null, clearPassword: false };
  }
}

/** Số giây còn lại → "4:32" cho câu đếm ngược và nhãn nút. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Luật khóa tài khoản khi đăng nhập sai (NFR-01): sai lần thứ N liên tiếp → khóa M phút,
 * tự mở khi hết hạn. N/M lấy từ system_config (AD-11), KHÔNG hardcode ở đây.
 *
 * Hàm THUẦN để test được mọi biên mà không cần DB.
 */
export interface LockoutState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

/** Tài khoản có đang bị khóa tại thời điểm `now` không. */
export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** Số giây còn lại của khóa — để trả cho UI đếm ngược. */
export function lockRemainingSeconds(state: LockoutState, now: Date): number {
  if (!isLocked(state, now)) return 0;
  return Math.ceil(((state.lockedUntil as Date).getTime() - now.getTime()) / 1000);
}

/** Sau một lần đăng nhập SAI. */
export function registerFailure(
  state: LockoutState,
  policy: LockoutPolicy,
  now: Date,
): LockoutState & { justLocked: boolean } {
  // Khóa cũ đã hết hạn → bộ đếm bắt đầu lại từ 0 (tự mở, NFR-01).
  const base = state.lockedUntil && !isLocked(state, now) ? 0 : state.failedAttempts;
  const failedAttempts = base + 1;
  if (failedAttempts >= policy.maxFailedAttempts) {
    return {
      failedAttempts,
      lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000),
      justLocked: true,
    };
  }
  return { failedAttempts, lockedUntil: null, justLocked: false };
}

/** Sau một lần đăng nhập ĐÚNG — xóa sạch dấu vết thất bại. */
export function registerSuccess(): LockoutState {
  return { failedAttempts: 0, lockedUntil: null };
}

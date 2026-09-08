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
      /*
       * `justLocked` = VỪA CHUYỂN sang trạng thái khóa, không phải "đang khóa".
       *
       * Nơi gọi dùng cờ này để gửi email báo SA. Bản trước trả `true` cho MỌI lượt sai từ
       * ngưỡng trở đi, nên sai lần thứ 6, 7, 8… đều bắn thêm một thư nữa. Trước 08/09 lỗi
       * này bị che bởi chính lỗi đua ở `login()`: mọi lượt song song đều ghi đè nhau về 1,
       * nên không lượt nào chạm ngưỡng hai lần. Sửa lỗi đua xong thì nó lộ ra ngay — 6 lượt
       * sai đồng thời đẻ ra HAI dòng `auth.account.locked` và hai thư (rà soát 08/09, #5).
       *
       * `!isLocked(...)` là đúng ngữ nghĩa chuyển trạng thái, và nó còn xử đúng ca hiếm:
       * admin hạ `login.max_failed_attempts` từ 10 xuống 5 trong lúc một tài khoản đang có 7
       * lượt sai mà chưa khóa — lượt kế tiếp phải khóa VÀ phải báo, dù `failedAttempts` đã
       * vượt ngưỡng từ trước. So bằng `=== maxFailedAttempts` sẽ bỏ sót đúng ca đó.
       */
      justLocked: !isLocked(state, now),
    };
  }
  return { failedAttempts, lockedUntil: null, justLocked: false };
}

/** Sau một lần đăng nhập ĐÚNG — xóa sạch dấu vết thất bại. */
export function registerSuccess(): LockoutState {
  return { failedAttempts: 0, lockedUntil: null };
}

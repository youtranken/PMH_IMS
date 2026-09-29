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
       * Nơi gọi dùng cờ này để gửi email báo SA. Trả `true` cho MỌI lượt sai từ ngưỡng trở
       * đi thì sai lần thứ 6, 7, 8… đều bắn thêm một thư nữa, và 6 lượt sai đồng thời đẻ ra
       * HAI dòng `auth.account.locked` và hai thư. Lỗi này dễ bị che: khi bộ đếm ở `login()`
       * còn đọc-rồi-ghi-đè thì mọi lượt song song đều ghi về 1, không lượt nào chạm ngưỡng
       * hai lần.
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

/**
 * Chặn theo TÀI KHOẢN, chậm dần (SEC-03, `docs/QUYET-DINH.md` Q-06).
 *
 * Bộ đếm theo cặp (người dùng, IP) ở trên không thấy kẻ dò đổi IP. Bộ đếm này đếm mọi lượt sai
 * của một tài khoản — sai mật khẩu và sai mã TOTP lúc đăng nhập — từ bất kỳ đâu. Cứ đủ
 * `threshold` lượt thì chặn một khoảng, dài dần theo `stepsMinutes`, dừng ở bậc cuối.
 *
 * Không khoá cứng: kẻ biết email chỉ làm người dùng thật chờ tối đa một bậc cuối, không khoá
 * được họ vĩnh viễn. Bộ đếm KHÔNG tự về 0 khi hết chờ — nếu về 0 thì kẻ dò được thêm
 * `threshold` lượt sau mỗi lần chờ và không bao giờ lên bậc. Chỉ đăng nhập trọn vẹn mới xoá.
 */
export interface BackoffPolicy {
  /** Số lượt sai cho mỗi bậc. 0 = tắt. */
  threshold: number;
  stepsMinutes: number[];
}

const DEFAULT_BACKOFF_STEPS = [5, 15, 30, 60];

export function registerAccountFailure(
  state: LockoutState,
  policy: BackoffPolicy,
  now: Date,
): LockoutState & { justLocked: boolean } {
  const failedAttempts = state.failedAttempts + 1;
  const hitsStep =
    policy.threshold > 0 &&
    policy.stepsMinutes.length > 0 &&
    failedAttempts % policy.threshold === 0;
  if (!hitsStep) {
    return { failedAttempts, lockedUntil: state.lockedUntil, justLocked: false };
  }
  const step = Math.min(failedAttempts / policy.threshold - 1, policy.stepsMinutes.length - 1);
  return {
    failedAttempts,
    lockedUntil: new Date(now.getTime() + policy.stepsMinutes[step] * 60_000),
    justLocked: true,
  };
}

/** "1,2,3,60" → [1, 2, 3, 60]. Chuỗi hỏng thì dùng mặc định, không để cấu hình sai mở toang cửa. */
export function parseBackoffSteps(raw: string): number[] {
  const parts = raw.split(',').map((p) => p.trim());
  const nums = parts.map(Number);
  const valid = parts.every((p) => p !== '') && nums.every((n) => Number.isInteger(n) && n > 0);
  return valid ? nums : [...DEFAULT_BACKOFF_STEPS];
}

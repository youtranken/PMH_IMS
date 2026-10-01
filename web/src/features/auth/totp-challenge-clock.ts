/**
 * Mốc bắt đầu bước nhập mã 2 lớp của TAB này (Q-20).
 *
 * Cố ý chỉ nằm trong bộ nhớ: tải lại trang hay mở tab mới ở `/login/2fa` là mất mốc, và màn nhập
 * mã coi đó là phiên chờ không rõ tuổi — đăng xuất rồi về đăng nhập. Ghi vào sessionStorage thì
 * F5 giữ được mốc, đúng thứ chủ dự án không muốn.
 */
let startedAt: number | null = null;

/** Màn đăng nhập gọi khi mật khẩu đúng và server đòi mã 2 lớp. */
export function markTotpChallengeStarted(now: number = Date.now()): void {
  startedAt = now;
}

export function totpChallengeStartedAt(): number | null {
  return startedAt;
}

/** Chỉ cho bài kiểm: trả về trạng thái "vừa nạp trang". */
export function resetTotpChallengeClock(): void {
  startedAt = null;
}

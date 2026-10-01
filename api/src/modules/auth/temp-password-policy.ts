/**
 * Mật khẩu tạm sống `hours` giờ kể từ lúc SA cấp (Q-20, `auth.temp_password_hours`). Nó đã đi
 * qua email hoặc điện thoại và nằm trong response của `POST /accounts`; để vô hạn thì thư cũ
 * trong hộp thư ai đó vẫn là chìa vào tài khoản chưa từng đăng nhập.
 */
export function tempPasswordExpiresAt(issuedAt: Date, hours: number): Date {
  return new Date(issuedAt.getTime() + hours * 3_600_000);
}

/**
 * Chỉ mật khẩu đang bị bắt đổi mới có thể hết hạn. Mật khẩu người dùng tự đặt không có hạn định
 * kỳ (Q-20, NIST SP 800-63B §5.1.1.2). Không có mốc (SA dựng bằng seed-sa, xem migration 0040)
 * = không hết.
 * Đúng mốc là hết — cùng quy ước "đủ N là chết" với hạn phiên.
 */
export function isTempPasswordExpired(
  user: { mustChangePassword: boolean; tempPasswordExpiresAt: Date | null },
  now: Date,
): boolean {
  if (!user.mustChangePassword || user.tempPasswordExpiresAt === null) return false;
  return now.getTime() >= user.tempPasswordExpiresAt.getTime();
}

/** Một câu cho cả cửa đăng nhập lẫn phiên đang mở: việc phải làm luôn là nhờ SA đặt lại. */
export const TEMP_PASSWORD_EXPIRED_MESSAGE =
  'Mật khẩu tạm đã hết hạn. Liên hệ SA để được đặt lại mật khẩu.';

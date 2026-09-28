/**
 * Email đăng nhập nhớ trên thiết bị — người duyệt mở thư trên điện thoại lúc 2 giờ sáng chỉ phải
 * gõ mật khẩu (hoặc để trình quản lý mật khẩu điền).
 *
 * CHỈ email, không bao giờ mật khẩu hay trạng thái phiên. localStorage vì phải sống qua lần đóng
 * trình duyệt; màn đăng nhập có nút "Không phải tôi" xoá nó cho máy dùng chung.
 */
const KEY = 'ims_login_email';

/** Giá trị trong kho có thể bị sửa tay — chỉ nhận thứ trông như một email. */
export function normalizeRememberedEmail(raw: string | null): string {
  const value = (raw ?? '').trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value)) return '';
  return value;
}

export function readRememberedEmail(): string {
  try {
    return normalizeRememberedEmail(localStorage.getItem(KEY));
  } catch {
    return '';
  }
}

export function rememberEmail(email: string): void {
  const value = normalizeRememberedEmail(email);
  if (!value) return;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Kho bị chặn: lần sau gõ lại email — mất tiện ích, không mất chức năng.
  }
}

export function forgetRememberedEmail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // như trên
  }
}

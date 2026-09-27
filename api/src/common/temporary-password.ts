import { randomBytes } from 'node:crypto';

/**
 * Mật khẩu tạm: 16 ký tự từ bảng chữ không gây nhầm lẫn khi đọc qua điện thoại
 * (bỏ 0/O, 1/l/I). Người dùng buộc đổi ngay lần đăng nhập đầu.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%';
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

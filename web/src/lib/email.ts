/**
 * Dạng email đủ để bắt lỗi gõ nhầm ở ô nhập (thiếu @, thiếu tên miền, dính dấu phẩy / chấm phẩy
 * của ô nhiều người nhận). Server vẫn là hàng rào cuối — đây chỉ để báo ngay dưới ô.
 */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

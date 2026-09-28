/**
 * Ô số giờ cấp của hộp Duyệt break-glass → số gửi lên API.
 *
 * Trả MỘT hình dạng `{ value, reason }` (tsconfig web không bật `strict`). "2 tiếng" hay "0"
 * phải bị báo, không được âm thầm rơi về một con số mặc định. Vượt số giờ người ta XIN cũng bị
 * báo: API kẹp theo số xin, nên để qua thì server cấp ít hơn con số người duyệt vừa gõ mà không
 * ai hay. `requested` null = phiếu không mang số giờ hợp lệ, chỉ còn trần cấu hình phía server.
 */
export function grantHoursCheck(
  raw: string,
  requested: number | null,
): { value: number | null; reason: 'invalid' | 'aboveAsked' | null } {
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) return { value: null, reason: 'invalid' };
  const value = Number(text);
  if (requested !== null && value > requested) return { value: null, reason: 'aboveAsked' };
  return { value, reason: null };
}

/** Số giờ đã xin trên phiếu, `null` khi phiếu không mang số nguyên dương. */
export function requestedHours(payload: { hours?: unknown } | null | undefined): number | null {
  const hours = Number(payload?.hours);
  return Number.isInteger(hours) && hours > 0 ? hours : null;
}

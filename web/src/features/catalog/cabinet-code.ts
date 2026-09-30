/**
 * Mã tủ gợi ý theo quy ước `TU-<MÃ SITE>-NN` — số kế tiếp sau số lớn nhất đang có ở site đó.
 *
 * Chỉ là GỢI Ý điền sẵn (người dùng sửa được): mã tủ thật chỉ cần duy nhất trong một site. Mã
 * không theo quy ước bị bỏ qua khi tính số kế tiếp, không làm hỏng gợi ý.
 */
export function suggestCabinetCode(siteCode: string, existingCodes: string[]): string {
  const prefix = `TU-${siteCode.trim().toUpperCase()}-`;
  let max = 0;
  for (const code of existingCodes) {
    max = Math.max(max, cabinetNumber(code, siteCode) ?? 0);
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/**
 * Số tủ trong site ("tủ 1, 2, 3") đọc từ đuôi mã `TU-<MÃ SITE>-NN`. Không có cột số tủ riêng:
 * mã đã duy nhất trong site và đã mang số, một cột nữa là hai nơi phải giữ khớp nhau. Mã không
 * theo quy ước thì không có số — trả `null`, form không bịa ra số.
 */
export function cabinetNumber(code: string, siteCode: string): number | null {
  const site = siteCode.trim().toUpperCase();
  if (!site) return null;
  const prefix = `TU-${site}-`;
  const upper = code.trim().toUpperCase();
  if (!upper.startsWith(prefix)) return null;
  const tail = upper.slice(prefix.length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

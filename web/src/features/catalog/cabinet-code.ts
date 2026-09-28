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
    const upper = code.trim().toUpperCase();
    if (!upper.startsWith(prefix)) continue;
    const tail = upper.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

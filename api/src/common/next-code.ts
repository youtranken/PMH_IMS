/**
 * Mã kế tiếp sau `last` (FM-21): giữ tiền tố, tăng phần SỐ ở cuối, giữ số chữ số (012 → 013),
 * nhảy qua mã đã có trong `taken` (không phân biệt hoa thường). Mã không kết thúc bằng số thì
 * không đoán — trả `null`, form để ô Mã trống như trước.
 */
export function nextCode(last: string | null, taken: readonly string[]): string | null {
  const match = last ? /^(.*?)(\d+)$/.exec(last.trim()) : null;
  if (!match) return null;
  const [, prefix, digits] = match;
  const used = new Set(taken.map((code) => code.trim().toUpperCase()));
  for (let n = Number(digits) + 1; ; n += 1) {
    const candidate = `${prefix}${String(n).padStart(digits.length, '0')}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
}

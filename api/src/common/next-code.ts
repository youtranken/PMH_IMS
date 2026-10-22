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
  // BigInt chứ không Number: số ≥ 16 chữ số (serial làm mã) vượt 2^53, `n + 1` không đổi `n` và
  // vòng lặp không bao giờ thoát — treo cả API. Trần số vòng = số mã đã có + 1 (luôn đủ để thoát).
  let n = BigInt(digits);
  for (let tries = 0; tries <= used.size; tries += 1) {
    n += 1n;
    const candidate = `${prefix}${n.toString().padStart(digits.length, '0')}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
  return null;
}

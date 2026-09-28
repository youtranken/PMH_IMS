/**
 * Cộng số năm vào một ngày ISO (`yyyy-mm-dd`), trả ngày ISO; đầu vào hỏng thì trả `''`.
 *
 * Tính trên số nguyên chứ không qua `Date`: `Date` đọc chuỗi ISO theo UTC còn `toISOString`
 * ghi lại theo UTC, lệch múi giờ là trượt một ngày. 29/02 sang năm không nhuận thì lùi về 28/02
 * — hạn bảo hành không được dài hơn hợp đồng.
 */
export function addYearsIso(iso: string, years: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const year = Number(match[1]) + years;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(Number(match[1]), month)) return '';
  const clamped = Math.min(day, daysIn(year, month));
  return `${String(year).padStart(4, '0')}-${match[2]}-${String(clamped).padStart(2, '0')}`;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

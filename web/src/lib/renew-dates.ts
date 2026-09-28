/**
 * Phép tính ngày của hộp Gia hạn (`ui/renew-dialog.tsx`). Mọi ngày là chuỗi YYYY-MM-DD theo
 * lịch địa phương — cùng hệ ngày với `DatePicker` — nên so sánh chuỗi là so sánh ngày.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Cộng tháng; ngày 31 sang tháng ngắn thì lùi về ngày cuối tháng, không tràn sang tháng sau. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
  return toIso(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  return toIso(new Date(y, m - 1, d + days));
}

/**
 * Ngày sớm nhất được chọn làm hạn mới: sau hạn cũ (API từ chối `newEnd <= endDate`) VÀ sau hôm
 * nay (Q-03: hồ sơ chỉ về Đang dùng khi hạn mới sau hôm nay — chọn ngày đã qua thì lượt quét kế
 * tiếp lại đẩy nó về Hết hạn).
 */
export function renewMinDate(end: string, today: string): string {
  return addDaysIso(end > today ? end : today, 1);
}

/**
 * Nút "+N tháng": tính từ hạn cũ khi còn hạn (gia hạn nối kỳ), từ hôm nay khi đã quá hạn —
 * nối từ một ngày đã qua thì kỳ mới ngắn hơn cái đã trả tiền.
 */
export function renewPreset(end: string, today: string, months: number): string {
  return addMonthsIso(end >= today ? end : today, months);
}

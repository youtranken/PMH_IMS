/**
 * "Hôm nay" theo MÚI GIỜ CỦA ỨNG DỤNG, không phải theo UTC.
 *
 * `new Date().toISOString()` luôn trả giờ UTC. Với múi giờ +07, từ 00:00 tới 07:00 sáng giờ
 * Việt Nam thì UTC vẫn là NGÀY HÔM QUA — nên mọi phép "còn bao nhiêu ngày" lệch một ngày
 * suốt 7 tiếng mỗi sáng: thứ hết hạn HÔM NAY bị báo là "còn 1 ngày", và người trực sáng sớm
 * nhìn màn cảnh báo thấy sai. (E2E story 3.4 bắt được lúc chạy lúc 6 giờ sáng.)
 *
 * `en-CA` cho ra đúng dạng YYYY-MM-DD, không phải mẹo mà là locale chuẩn của Canada.
 */
export function isoDateInTz(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // Múi giờ cấu hình sai không được làm sập cả màn cảnh báo — lùi về UTC và chạy tiếp.
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Mốc thời gian → chuỗi "dd/mm/yyyy HH:mm" theo MÚI GIỜ ỨNG DỤNG, cho ô của file Excel xuất.
 *
 * Không đưa `Date` thô vào ô: ExcelJS quy nó về số serial theo giờ UTC, nên việc xảy ra lúc 2
 * giờ sáng giờ Việt Nam hiện là 19 giờ HÔM TRƯỚC trong file — lệch so với màn vừa bấm xuất.
 */
export function dateTimeInTz(at: Date | null, timeZone: string): string {
  if (!at) return '';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    // Múi giờ cấu hình sai lùi về ISO chứ không ném — cùng nếp với `isoDateInTz`.
    return at.toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD, tính theo NGÀY LỊCH. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Số ngày từ `from` tới `end` (âm = đã quá hạn). */
export function daysBetween(from: string, end: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

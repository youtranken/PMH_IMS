import { daysBetween, isoDateInTz } from '../../common/today';

/**
 * Lịch mail nhắc phiếu ISO — hàm THUẦN. Mỗi việc tối đa một mail mỗi ngày (khoá chặn
 * trùng ở `iso_reminder_sent`); các hàm dưới chỉ trả lời "hôm nay có tới lượt nhắc không".
 */

/** Nhắc gửi chốt: đúng ngày cuối kỳ, rồi cứ `every` ngày nhắc lại tới khi gửi. */
export function submitReminderDue(lastDay: string, today: string, every: number): boolean {
  if (today < lastDay) return false;
  const step = Math.max(1, every);
  return daysBetween(lastDay, today) % step === 0;
}

/**
 * Việc tồn quá `n` ngày kể từ mốc `since` (theo NGÀY giờ Việt Nam): nhắc ở ngày thứ n, 2n, 3n…
 * — không phải mỗi ngày, để mail nhắc không thành thứ người ta lọc vào thùng rác.
 */
export function nthDayDue(since: Date, today: string, n: number, timeZone: string): boolean {
  const step = Math.max(1, n);
  const days = daysBetween(isoDateInTz(timeZone, since), today);
  return days >= step && days % step === 0;
}

/** Có ô / ngày còn trống từ `n` ngày trước trở về → mail nhắc gửi thêm cho người dự phòng. */
export function backupRecipientsDue(missedDays: string[], today: string, n: number): boolean {
  return missedDays.some((day) => daysBetween(day, today) >= Math.max(1, n));
}

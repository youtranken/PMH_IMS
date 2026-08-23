/**
 * Đến kỳ gửi báo cáo chưa? — hàm THUẦN, không chạm DB, không đọc đồng hồ.
 *
 * Tách ra vì đây là chỗ dễ sai nhất của cả story: sweep chạy mỗi phút, luật gửi "hằng tuần
 * thứ Hai 8 giờ". Sai một chút là hoặc gửi 60 lần một sáng, hoặc lỡ luôn cả tuần. Kiểm bằng
 * bảng dữ liệu rẻ hơn nhiều so với ngồi chờ tới thứ Hai để xem có gửi không.
 */

export type DigestFrequency = 'daily' | 'weekly' | 'monthly';

export interface DigestSchedule {
  frequency: DigestFrequency;
  /** Giờ gửi trong ngày, 0–23 (theo múi giờ ứng dụng). */
  hour: number;
  /** 1=Thứ Hai … 7=Chủ Nhật. Chỉ dùng khi frequency='weekly'. */
  weekday?: number | null;
  /** Ngày trong tháng 1–28. Chỉ dùng khi frequency='monthly'. */
  dayOfMonth?: number | null;
}

/** Các thành phần thời gian ĐÃ quy về múi giờ ứng dụng — nơi gọi tự quy đổi. */
export interface LocalNow {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  /** 1=Thứ Hai … 7=Chủ Nhật */
  weekday: number;
  /** 1–31 */
  dayOfMonth: number;
}

/**
 * Quy tắc: đến ĐÚNG NGÀY và ĐÃ QUA giờ hẹn, mà kỳ này chưa gửi lần nào.
 *
 * Dùng "đã qua giờ hẹn" (`>=`) chứ không phải "đúng giờ hẹn" (`===`): sweep có thể lỡ nhịp
 * vì Redis chết, máy ngủ, hay container restart đúng lúc 8 giờ. Với `===` thì lỡ một phút
 * là mất cả kỳ; với `>=` thì hệ thống sống lại lúc 9 giờ vẫn gửi bù, và `lastSentAt` chặn
 * gửi trùng.
 */
export function shouldSendNow(
  schedule: DigestSchedule,
  now: LocalNow,
  lastSentDate: string | null,
): boolean {
  if (now.hour < schedule.hour) return false;
  if (!isDueToday(schedule, now)) return false;
  // Kỳ này đã gửi rồi (so theo NGÀY, không theo giờ) → thôi.
  return lastSentDate !== now.date;
}

function isDueToday(schedule: DigestSchedule, now: LocalNow): boolean {
  switch (schedule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return now.weekday === (schedule.weekday ?? 1);
    case 'monthly':
      return now.dayOfMonth === (schedule.dayOfMonth ?? 1);
  }
}

/** Mô tả kỳ gửi bằng tiếng Việt — dùng trong email và log, khớp `describeSchedule` phía web. */
export function describeSchedule(schedule: DigestSchedule): string {
  const hour = `${String(schedule.hour).padStart(2, '0')}:00`;
  if (schedule.frequency === 'daily') return `Hằng ngày lúc ${hour}`;
  if (schedule.frequency === 'weekly') {
    return `Hằng tuần, ${WEEKDAY_LABEL[schedule.weekday ?? 1]} lúc ${hour}`;
  }
  return `Hằng tháng, ngày ${schedule.dayOfMonth ?? 1} lúc ${hour}`;
}

const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
  7: 'Chủ Nhật',
};

/**
 * Tách một mốc thời gian thành các thành phần theo múi giờ cho trước.
 * `Date.getDay()` trả 0=Chủ Nhật; hệ thống dùng 1=Thứ Hai…7=Chủ Nhật nên phải đổi.
 */
export function localNowIn(timeZone: string, now: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  // 'hour' có thể là '24' ở hour12:false trong một số môi trường — quy về 0.
  const hour = Number(get('hour')) % 24;
  const weekday = WEEKDAY_FROM_SHORT[get('weekday')] ?? 1;
  return { date, hour, weekday, dayOfMonth: Number(get('day')) };
}

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

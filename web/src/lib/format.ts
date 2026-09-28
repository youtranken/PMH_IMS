/**
 * Định dạng hiển thị dùng chung (AD-15) — spine: lưu UTC, hiển thị giờ Việt Nam.
 * Không màn nào tự gọi toLocaleString với option riêng.
 */
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const dateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  // Ghép từ từng phần: `vi-VN` in GIỜ trước ngày ("23:16 27/09/2026"), ngược thói quen đọc
  // và ngược mọi ô ngày khác của app.
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateTimeParts(date).find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

function dateTimeParts(date: Date): Intl.DateTimeFormatPart[] {
  return dateTimeFmt.formatToParts(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

// `en-CA` in ra đúng dạng YYYY-MM-DD mà ô ngày và API cùng nhận.
const isoDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * "Hôm nay" dạng YYYY-MM-DD theo giờ Việt Nam — giá trị mặc định cho ô ngày.
 *
 * Không dùng `toISOString().slice(0, 10)`: từ 00:00 tới 07:00 giờ VN thì UTC còn là hôm qua.
 */
export function todayIso(now: Date = new Date()): string {
  return isoDayFmt.format(now);
}

const moneyFmt = new Intl.NumberFormat('vi-VN');

/**
 * Tiền đồng (AD-15) — "3.500.000 ₫", không phải "3500000".
 *
 * Tự ghép ký hiệu thay vì `style: 'currency'`: bản currency của vi-VN chèn dấu cách KHÔNG
 * NGẮT (U+00A0) trước ₫, nên chuỗi trông giống hệt mà so sánh trong test lại trượt.
 *
 * Không có giá trị = một dấu gạch, KHÔNG phải "0 ₫": "chưa khai chi phí" và "được tặng, giá
 * 0đ" là hai chuyện khác nhau, gộp lại là bịa dữ liệu.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${moneyFmt.format(value)} ₫`;
}

/** Ô trống trong bảng luôn là một dấu gạch, không phải chuỗi rỗng khó nhìn. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export interface AgoParts {
  unit: 'now' | 'minutes' | 'hours' | 'days';
  count: number;
}

/**
 * "… trước" của một mốc — hàm thuần, màn hình ghép câu qua i18n. Làm tròn XUỐNG (59 phút chưa
 * phải "1 giờ"); mốc nằm ở tương lai (đồng hồ máy lệch) coi là "vừa xong", không ra số âm.
 */
export function agoParts(value: string | Date, now: number): AgoParts | null {
  const at = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return { unit: 'now', count: 0 };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

/** Tách số giây còn lại thành giờ/phút/giây để ghép câu "còn 3 giờ 52 phút". Không bao giờ âm. */
export function remainingParts(seconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const total = Math.max(0, Math.floor(seconds));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

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
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
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

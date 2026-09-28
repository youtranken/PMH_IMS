export type Period = 'month' | 'quarter' | 'year';

export const PERIODS: Period[] = ['month', 'quarter', 'year'];

const pad = (value: number) => String(value).padStart(2, '0');

/** Ngày cuối của tháng `month` (1–12) — ngày 0 của tháng sau, tự lo năm nhuận. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Khoảng từ–đến (YYYY-MM-DD, cả hai đầu tính) của tháng/quý/năm CHỨA `today`.
 *
 * `today` truyền vào từ `todayIso()` (múi giờ ứng dụng) chứ không tự `new Date()`: 00:30 sáng
 * ngày 01/10 giờ VN vẫn là 30/09 ở UTC, và "quý này" khi đó phải là quý 4.
 */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const [first, last] =
    period === 'month'
      ? [month, month]
      : period === 'quarter'
        ? [Math.floor((month - 1) / 3) * 3 + 1, Math.floor((month - 1) / 3) * 3 + 3]
        : [1, 12];
  return {
    from: `${year}-${pad(first)}-01`,
    to: `${year}-${pad(last)}-${pad(lastDay(year, last))}`,
  };
}

/** Khoảng đang lọc trùng đúng preset nào (để bật nút đó); không trùng thì chuỗi rỗng. */
export function matchPeriod(from: string, to: string, today: string): Period | '' {
  if (!from || !to) return '';
  return PERIODS.find((period) => {
    const range = periodRange(period, today);
    return range.from === from && range.to === to;
  }) ?? '';
}

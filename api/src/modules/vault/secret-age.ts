const MS_PER_DAY = 86_400_000;

/**
 * Giá trị trong một ngăn đã bao lâu chưa đổi, và đã quá ngưỡng `dashboard.secret_stale_days`
 * chưa (AD-11). Cùng cách đếm với khối "két lâu chưa đổi" của bảng điều khiển: ngày tròn xuống,
 * `>=` ngưỡng — đặt 180 thì ngày thứ 180 là hiện.
 */
export function valueAge(changedAt: Date, staleDays: number, now: Date): { days: number; stale: boolean } {
  const days = Math.max(0, Math.floor((now.getTime() - changedAt.getTime()) / MS_PER_DAY));
  return { days, stale: days >= staleDays };
}

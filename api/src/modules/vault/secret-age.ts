const MS_PER_DAY = 86_400_000;

/**
 * Giá trị trong một ngăn đã bao lâu chưa đổi, và đã quá ngưỡng `dashboard.secret_stale_days`
 * chưa (AD-11). Cùng cách đếm với khối "két lâu chưa đổi" của bảng điều khiển: ngày tròn xuống,
 * `>=` ngưỡng — đặt 180 thì ngày thứ 180 là hiện.
 */
export function valueAge(
  changedAt: Date,
  staleDays: number,
  now: Date,
): { days: number; stale: boolean; dueInDays: number } {
  const days = Math.max(0, Math.floor((now.getTime() - changedAt.getTime()) / MS_PER_DAY));
  /*
   * Đếm ngược tới hạn đổi (Q-15): còn bao nhiêu ngày, âm là đã quá bấy nhiêu ngày. Tính từ CÙNG
   * `days` và CÙNG ngưỡng với `stale`, nên "còn 0 ngày" luôn trùng lúc `stale` bật — hai chữ trên
   * màn hình không thể nói ngược nhau. Đổi giá trị là `changedAt` mới, đếm lại từ đầu.
   */
  return { days, stale: days >= staleDays, dueInDays: staleDays - days };
}

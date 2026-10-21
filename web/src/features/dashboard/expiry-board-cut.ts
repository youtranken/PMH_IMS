/**
 * Bảng hết hạn trên điện thoại: mỗi nhóm (quá hạn / sắp tới) bày `per` mục đầu. Cắt chung một
 * lượt trước khi tách nhóm thì mục quá hạn — luôn đứng trước — ăn hết chỗ, và cả nhóm "Sắp tới"
 * (kể cả mục hết hạn hôm nay có nút Gia hạn) biến mất sau nút "Xem thêm".
 */
export function cutExpiryBoard<T extends { daysLeft: number }>(
  items: readonly T[],
  { narrow, all, per }: { narrow: boolean; all: boolean; per: number },
): { overdue: T[]; upcoming: T[]; hidden: number } {
  const overdue = items.filter((item) => item.daysLeft < 0);
  const upcoming = items.filter((item) => item.daysLeft >= 0);
  if (!narrow || all) return { overdue, upcoming, hidden: 0 };
  return {
    overdue: overdue.slice(0, per),
    upcoming: upcoming.slice(0, per),
    hidden: Math.max(0, overdue.length - per) + Math.max(0, upcoming.length - per),
  };
}

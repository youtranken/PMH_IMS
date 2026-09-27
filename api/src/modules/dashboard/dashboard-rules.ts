/**
 * Luật chọn dòng cho ba khối mới của bảng điều khiển — HÀM THUẦN, không chạm DB, không `new Date()`.
 *
 * Tách ra khỏi `dashboard.service.ts` vì đây mới là chỗ dễ sai: "sắp đầy là bao nhiêu", "cũ là
 * từ bao giờ", "mốc so sánh nằm ở đầu nào". Ba câu đó kiểm bằng bảng dữ liệu trong vài mili
 * giây; kiểm qua HTTP thì phải dựng DB, và mỗi trường hợp biên lại là một bản ghi phải gieo.
 *
 * `now` luôn là THAM SỐ, không bao giờ đọc đồng hồ bên trong: hàm đọc đồng hồ thì test phải
 * đóng băng thời gian, và cái test đó sẽ đỏ vào một buổi sáng nào đó vì lý do không liên quan.
 *
 * Không hàm nào ở đây nhận `limit`. Chúng trả lời "dòng nào khớp, xếp theo thứ tự nào" — cắt
 * bao nhiêu dòng là chuyện bày biện của nơi gọi. Nhận `limit` thì nơi gọi vẫn phải đếm tổng
 * bằng cách nào đó, và cách nhanh nhất là chép lại chính điều kiện lọc ra ngoài — hai bản của
 * cùng một luật, rồi một hôm sửa một bản.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Số ngày trọn vẹn từ `from` tới `to`. Âm nếu `from` ở tương lai.
 *
 * Làm tròn XUỐNG: một secret đổi cách đây 179 ngày 23 giờ là "179 ngày", không phải 180 — nếu
 * làm tròn lên thì nó lọt vào danh sách "cũ" sớm hơn một ngày so với con số người ta đặt ra,
 * và ai đi đối chiếu sẽ thấy lệch mà không hiểu vì sao.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface SubnetLoadInput {
  percent: number;
  total: number;
}

/**
 * Dải mạng đáng đưa lên bảng điều khiển: đầy từ `minPercent` trở lên, đầy nhất lên đầu.
 *
 * Loại thẳng dải có `total === 0` (CIDR hỏng, hoặc /32 không còn địa chỉ nào cấp được): với
 * chúng `subnetUsage` trả `percent: 0`, nên chúng không lọt vào đây bằng đường nào khác — trừ
 * khi có người đặt `minPercent = 0`. Chặn tường minh vì "dải không chứa được gì" không phải
 * "dải sắp đầy", và một dòng như thế trên bảng điều khiển chỉ tổ làm người ta đi tìm nhầm chỗ.
 */
export function pickLoadedSubnets<T extends SubnetLoadInput>(
  rows: T[],
  minPercent: number,
): T[] {
  return rows
    .filter((row) => row.total > 0 && row.percent >= minPercent)
    .sort((a, b) => b.percent - a.percent);
}

export interface StaleOwnerInput {
  lastChangeAt: Date;
}

/**
 * Két lâu không đổi: `staleDays` trở lên tính tới `now`, cũ nhất lên đầu.
 *
 * `>=` chứ không `>`: người vận hành đặt 180 thì trông đợi ngày thứ 180 là nó xuất hiện, không
 * phải ngày 181.
 *
 * Trả kèm `daysSince` để bên gọi khỏi tính lại — tính hai lần ở hai chỗ là hai cơ hội để một
 * chỗ dùng `Math.round` còn chỗ kia dùng `Math.floor`, rồi bảng hiện 180 mà bộ lọc bảo chưa tới.
 */
export function pickStaleOwners<T extends StaleOwnerInput>(
  rows: T[],
  staleDays: number,
  now: Date,
): (T & { daysSince: number })[] {
  return rows
    .map((row) => ({ ...row, daysSince: daysBetween(row.lastChangeAt, now) }))
    .filter((row) => row.daysSince >= staleDays)
    .sort((a, b) => b.daysSince - a.daysSince);
}

export interface RecentInput {
  updatedAt: Date | null;
}

/**
 * Hồ sơ vừa đổi trong `withinDays` ngày gần đây, mới nhất lên đầu.
 *
 * `updatedAt === null` bị loại: không biết đổi lúc nào thì không kết luận được là "vừa". Cho nó
 * qua sẽ ghim một hồ sơ không có ngày lên khối "tuần này" và nó nằm đó mãi mãi.
 *
 * Mốc tương lai (đồng hồ máy chủ lệch, dữ liệu nhập tay sai năm) vẫn tính là "vừa" — `daysBetween`
 * ra số âm, nhỏ hơn `withinDays`. Đúng hơn là giấu đi: một hồ sơ mang ngày năm 2030 là thứ cần
 * có người nhìn thấy.
 */
export function pickRecent<T extends RecentInput>(
  rows: T[],
  withinDays: number,
  now: Date,
): T[] {
  return rows
    .filter((row) => row.updatedAt !== null && daysBetween(row.updatedAt, now) <= withinDays)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
}

export interface ExpiringInput {
  daysLeft: number;
}

/**
 * Chọn mục cho khối "sắp hết hạn" của trang chủ.
 *
 * Mục quá hạn luôn có ngày nhỏ nhất, nên cắt `max` dòng đầu của một danh sách sắp theo ngày thì
 * vài hồ sơ quá hạn lâu năm chiếm trọn khối, và chứng chỉ còn 2 ngày — thứ còn kịp cứu — không
 * bao giờ lên. Nên quá hạn chỉ được giữ tối đa `overdueSlots` chỗ; chỗ còn lại dành cho mục sắp
 * tới gấp nhất, và chỉ khi sắp tới không đủ lấp thì quá hạn mới lấp tiếp.
 *
 * `upcoming` phải đã sắp gấp nhất trước; `overdue` giữ nguyên thứ tự nơi gọi đưa.
 */
export function pickExpiring<T extends ExpiringInput>(
  upcoming: T[],
  overdue: T[],
  max: number,
  overdueSlots: number,
): T[] {
  const reserved = Math.min(overdueSlots, overdue.length, max);
  const soon = upcoming.slice(0, max - reserved);
  const late = overdue.slice(0, max - soon.length);
  return [...late, ...soon].sort((a, b) => a.daysLeft - b.daysLeft);
}

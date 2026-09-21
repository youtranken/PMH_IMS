/**
 * Ghép bản sửa với hồ sơ đang có, để luật soi trên GIÁ TRỊ SAU KHI GHÉP.
 *
 * ===== VÌ SAO KHÔNG DÙNG `??` =====
 *
 * Mọi `prepare()` trong repo dựng một túi `values` chỉ chứa những trường CÓ MẶT trong yêu
 * cầu (`put` bỏ qua `undefined`). Nên túi ấy phân biệt được ba trạng thái:
 *
 *   · không có khoá        → người dùng KHÔNG đụng tới ô này
 *   · có khoá, giá trị null → người dùng ĐÃ XOÁ ô này
 *   · có khoá, có giá trị   → người dùng đặt giá trị mới
 *
 * `values.endDate ?? current?.endDate` bóp hai trạng thái đầu thành một: `null` (đã xoá)
 * rơi xuống nhánh dự phòng y hệt `undefined` (không đụng tới). Luật vì thế đi soi giá trị
 * CŨ — giá trị vừa bị xoá — và sai theo cả hai chiều:
 *
 *   · lọt cái phải chặn — xoá hạn của một chứng chỉ SSL không làm `requiresEndDate` nổ,
 *     nhưng câu ghi vẫn ghi `NULL`; hồ sơ biến khỏi mọi lời nhắc gia hạn, không dòng lỗi nào;
 *   · chặn cái phải cho qua — xoá ngày bắt đầu rồi đặt hạn sớm hơn ngày bắt đầu CŨ bị từ
 *     chối bởi một giá trị không còn tồn tại, và người dùng không có đường nào thoát ra.
 *
 * `field in values` hỏi đúng câu cần hỏi: "yêu cầu này có nói gì về ô đó không?".
 *
 * Bản đầu tiên của idiom này nằm trong `device-import.ts` từ 08/09 (rà soát 07/09 bắt được
 * đúng lớp lỗi trên cặp ngày bảo hành và cặp site/tủ của đường Excel). Ba service HTTP viết
 * sau đó không dùng nó — A-03 của rà soát 19/09. Gom về một chỗ để lần sau chỉ có MỘT bản
 * của luật này, thay vì một bản đúng và ba bản sai.
 */
/**
 * ===== VÌ SAO KHÔNG PHẢI `field in values` (sửa 21/09/2026) =====
 *
 * Bản đầu viết `field in values`, và nó hỏng theo HAI chiều — cả hai đều lộ ra ở lượt rà
 * soát chéo đợt A+B, không chiều nào lộ ra ở cổng nào:
 *
 *  1. `in` ĐI LÊN CHUỖI PROTOTYPE. `'toString' in {}` là `true`, nên một túi values rỗng
 *     vẫn "có" `toString`, `constructor`, `valueOf`… và hàm trả về HÀM của prototype thay vì
 *     giá trị dự phòng. Trường ghép hôm nay luôn là tên cột thật nên chưa nổ — nhưng đây là
 *     một hàm dùng chung, và "chưa ai truyền tên lạ vào" không phải một hàng rào.
 *
 *  2. KHOÁ CÓ MẶT MANG `undefined` bị coi là "người dùng đã gửi". `nat-rule.service` truyền
 *     thẳng object mà controller dựng — đủ mười khoá, khoá không gửi thì `undefined` — nên
 *     mọi ô đều "có mặt" và mọi bản sửa biến thành xoá sạch. Ba nơi đợt B sửa thoát nạn chỉ
 *     vì `values` ở đó do `put()` dựng, mà `put()` bỏ qua `undefined`: hàm này đang sống
 *     nhờ một hợp đồng NGẦM mà nơi gọi phải nhớ. Nơi gọi thứ tư không nhớ.
 *
 * JSON không có `undefined`: "khoá vắng mặt" và "khoá mang `undefined`" là cùng một ý định.
 * Chỉ `null` mới là ý định XOÁ — và đó chính là phân biệt mà cả hàm này sinh ra để giữ.
 */
export function effectiveValue<T>(
  values: Record<string, unknown>,
  field: string,
  fallback: T,
): T {
  if (!Object.prototype.hasOwnProperty.call(values, field)) return fallback;
  const sent = values[field];
  return sent === undefined ? fallback : (sent as T);
}

/**
 * Buộc sẵn túi `values` cho gọn nơi gọi — `prepare()` nào cũng ghép nhiều trường liền nhau.
 */
export function effectiveOf(values: Record<string, unknown>) {
  return <T>(field: string, fallback: T): T => effectiveValue(values, field, fallback);
}

/*
 * BẬT LẠI HỒ SƠ IP CŨNG PHẢI QUA HÀNG RÀO "NẰM TRONG DẢI" — cửa cuối mà 0040 chưa bịt.
 *
 * ===== LỖ =====
 *
 * `ip_address_within_subnet_upd` khai `BEFORE UPDATE **OF address, subnet_id**`. Danh sách
 * cột đó là một BỘ LỌC: Postgres chỉ gọi trigger khi câu UPDATE có nhắc tới một trong hai
 * cột ấy. `IpAddressService.restore()` chỉ đặt `voided_at`/`voided_by`/`void_reason`/
 * `updated_at`, nên trigger không bao giờ chạy trên đường bật lại.
 *
 * Ghép với hàng rào đổi dải, ba thao tác bình thường dựng lại đúng trạng thái mà 0040 tuyên
 * bố đã xoá sổ — và lần này KHÔNG cần cuộc đua nào:
 *
 *   1. Ẩn hồ sơ 10.0.0.5 ("khai nhầm địa chỉ").
 *   2. Sửa dải sang 192.168.1.0/24. ĐƯỢC PHÉP: `SubnetService.update` chỉ đếm IP đang sống
 *      (`voided_at IS NULL`), mà hồ sơ vừa ẩn thì không được đếm.
 *   3. Bấm "Bật lại".
 *
 * Kết quả tệ hơn thứ 0040 mô tả: `listBySubnet` liệt kê host theo cidr MỚI nên hàng
 * 10.0.0.5 vô hình trên mọi màn dải, trong khi `listForDevice` và sổ NAT vẫn trả nó ra. Một
 * địa chỉ có thật, có chủ, không màn nào sửa được.
 *
 * ===== VÁ =====
 *
 * Hai việc, và việc thứ hai mới là phần tinh:
 *
 * 1. Thêm `voided_at` vào danh sách `UPDATE OF` để trigger chạy trên đường bật lại.
 *
 * 2. Đổi câu hỏi của trigger từ "cột nào vừa bị đụng" sang "hàng này có ĐANG SỐNG không".
 *    Không có vế này thì bản vá tự bắn vào chân: `voidSubnet` ẩn hàng loạt IP của một dải đã
 *    thu hẹp sẽ nổ ngay giữa transaction, và người dùng mất luôn đường DUY NHẤT để dọn một
 *    dải hỏng. Hàng đã ẩn thì không hiện ở đâu và không cấp cho máy nào được, nên nó nằm
 *    ngoài dải cũng không hại ai — ràng buộc chỉ có nghĩa với hàng đang sống.
 *
 * AD-10: chỉ tiến. `CREATE OR REPLACE FUNCTION` giữ nguyên trigger INSERT đang trỏ vào nó;
 * chỉ trigger UPDATE phải dựng lại vì `UPDATE OF` không sửa tại chỗ được.
 */

CREATE OR REPLACE FUNCTION ip_address_within_subnet() RETURNS trigger AS $$
DECLARE
  parent cidr;
BEGIN
  /*
   * Hàng đã ẩn được miễn: ẩn là đường DỌN. Xem đầu file — không có dòng này thì `voidSubnet`
   * không dọn nổi chính cái dải mà nó cần dọn.
   */
  IF NEW.voided_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  /*
   * `FOR SHARE` chứ không phải SELECT trần: giữ hàng subnet lại cho tới khi lượt ghi này
   * commit, nên không ai đổi được dải ra sau lưng nó (0040).
   */
  SELECT cidr INTO parent FROM subnet WHERE id = NEW.subnet_id FOR SHARE;
  IF parent IS NULL THEN
    RAISE EXCEPTION 'Subnet % không tồn tại', NEW.subnet_id;
  END IF;
  IF NOT (NEW.address <<= parent) THEN
    RAISE EXCEPTION 'Địa chỉ % không nằm trong dải %', NEW.address, parent
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER ip_address_within_subnet_upd ON ip_address;
CREATE TRIGGER ip_address_within_subnet_upd
  BEFORE UPDATE OF address, subnet_id, voided_at ON ip_address
  FOR EACH ROW EXECUTE FUNCTION ip_address_within_subnet();

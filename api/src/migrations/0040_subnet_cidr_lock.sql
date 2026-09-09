/*
 * KHÓA HÀNG `subnet` KHI KIỂM IP NẰM TRONG DẢI — đóng cuộc đua giữa "đổi dải" và "khai IP".
 *
 * ===== LỖ =====
 *
 * `SubnetService.update` không cho đổi `cidr` khi dải đã có hồ sơ IP. Chú thích ngay tại đó
 * nói rõ vì sao: thu hẹp dải thì những IP nằm ngoài dải mới "trở thành rác lặng lẽ — trigger
 * chỉ chạy khi INSERT/UPDATE chính hàng IP, nên chúng ở lại, vẫn hiện trên màn hình, vẫn
 * trông hợp lệ".
 *
 * Nhưng hàng rào đó đếm IP ở NGOÀI transaction rồi mới mở transaction để ghi, và trigger
 * `ip_address_within_subnet()` đọc `subnet.cidr` bằng một câu SELECT TRẦN. Ở mức cô lập
 * READ COMMITTED, hai việc đó không thấy nhau:
 *
 *     T1 (đổi dải 10.0.0.0/24 → 192.168.1.0/24): đếm IP đang sống = 0, quyết định cho đổi.
 *     T2 (khai IP 10.0.0.5): trigger đọc dải CŨ, thấy hợp lệ, INSERT, COMMIT.
 *     T1: UPDATE cidr, COMMIT.
 *
 * Kết quả là đúng thứ chú thích kia tự hứa sẽ không bao giờ để xảy ra: một hàng 10.0.0.5 nằm
 * trong một dải 192.168.1.0/24. Trigger không bao giờ chạy lại trên hàng đó. Không có lỗi,
 * không có cảnh báo — chỉ có một cái máy không ra được mạng, phát hiện ra vào một ngày khác.
 *
 * ===== VÁ =====
 *
 * Trigger đọc `subnet` bằng `FOR SHARE`, và `update()` khóa hàng subnet bằng `FOR UPDATE`
 * TRƯỚC KHI đếm (trong cùng transaction). Hai khóa đó loại trừ nhau, nên hai thứ tự đều đúng:
 *
 *   - T1 khóa trước: T2 chờ tới khi T1 commit, đọc lại dải MỚI, và từ chối 10.0.0.5.
 *   - T2 khóa trước: T1 chờ tới khi T2 commit, rồi mới đếm — thấy 1 IP, từ chối đổi dải.
 *
 * Chi phí gần như bằng không ở đời thật: khai IP là việc thường xuyên nhưng chỉ khóa CHIA SẺ
 * (nhiều IP cùng dải khai song song vẫn không chờ nhau), còn đổi dải là việc hiếm.
 *
 * AD-10: chỉ tiến. `CREATE OR REPLACE FUNCTION` giữ nguyên hai trigger đang trỏ vào nó.
 */

CREATE OR REPLACE FUNCTION ip_address_within_subnet() RETURNS trigger AS $$
DECLARE
  parent cidr;
BEGIN
  /*
   * `FOR SHARE` chứ không phải SELECT trần: giữ hàng subnet lại cho tới khi lượt khai IP này
   * commit, nên không ai đổi được dải ra sau lưng nó. Xem đầu file.
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

-- Một thiết bị giữ tối đa MỘT IP đang cấp (Q-20). Trọng tài ở DB chứ không chỉ ở service: hai
-- người cùng cấp IP cho một máy trong cùng khoảnh khắc thì câu kiểm trước của service đều thấy
-- "máy chưa có IP" và cả hai cùng ghi; chỉ chỉ mục này loại được một lượt.
--
-- Vị từ chỉ tính hàng ĐANG CẤP còn sống: hồ sơ đã thu hồi (`free`) bị gỡ chủ, hồ sơ đã ẩn không
-- còn là IP của ai. IP gán cho người / phòng ban (device_id NULL) không bị luật này ràng.
--
-- `CREATE UNIQUE INDEX` thường, không CONCURRENTLY: lúc thêm file này bảng ip_address chưa có dữ
-- liệu thật, khoá ghi trong lúc dựng chỉ mục không chặn ai. Nếu DB đích đã có hai IP đang cấp cho
-- cùng một máy thì file này dừng ở đây — phải thu hồi bớt IP thừa trước rồi mới chạy lại.
CREATE UNIQUE INDEX ip_address_device_uq ON ip_address USING btree (device_id)
  WHERE device_id IS NOT NULL AND voided_at IS NULL AND status = 'assigned';

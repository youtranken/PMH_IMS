-- DOM-02 (QUYET-DINH Q-02): địa chỉ IP chỉ còn hai trạng thái, 'free' (Trống) và 'assigned'
-- (Đang dùng). Bỏ 'suspect_dead' và 'reclaimed'.
--
--   suspect_dead → assigned : "nghi chết" chưa bao giờ trả chỗ về pool, máy vẫn giữ IP.
--   reclaimed    → free     : thu hồi là trả chỗ về pool; xoá máy và người dùng y như đường
--                             "Thu hồi" của service làm, để không còn hàng lai "trống mà có chủ"
--                             (hàng lai đó khoá thiết bị khi thanh lý — A-06).
--
-- Áp cho CẢ hàng đã ẩn: CHECK kiểm mọi hàng, và "Bật lại" một hàng ẩn phải ra trạng thái hợp lệ.
--
-- ip_history là chỉ-thêm (AD-13): dòng cũ giữ nguyên tên trạng thái cũ, web vẫn đọc được. Mỗi
-- hàng bị đổi được ghi thêm MỘT dòng lịch sử, vì đổi trạng thái mà lịch sử không có dấu vết là
-- đúng thứ AC 5.2 cấm ("đổi trạng thái phải qua transition").

INSERT INTO ip_history (ip_address_id, action, actor, from_status, to_status, changes)
SELECT
  id,
  'ip.status_merged',
  'system:migration',
  status,
  CASE status WHEN 'suspect_dead' THEN 'assigned' ELSE 'free' END,
  jsonb_build_object(
    'reason', 'Q-02: IP chỉ còn hai trạng thái Trống / Đang dùng',
    'previousDeviceId', device_id,
    'previousUsedBy', used_by,
    'deviceId', CASE status WHEN 'suspect_dead' THEN device_id::text END,
    'usedBy', CASE status WHEN 'suspect_dead' THEN used_by END
  )
FROM ip_address
WHERE status IN ('suspect_dead', 'reclaimed');

UPDATE ip_address
   SET status = 'assigned', updated_at = now()
 WHERE status = 'suspect_dead';

UPDATE ip_address
   SET status = 'free', device_id = NULL, used_by = NULL, updated_at = now()
 WHERE status = 'reclaimed';

ALTER TABLE ip_address DROP CONSTRAINT ip_address_status_check;
ALTER TABLE ip_address
  ADD CONSTRAINT ip_address_status_check CHECK (status IN ('free', 'assigned'));

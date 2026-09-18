/*
 * CẢNH BÁO NGƯỜI ĐANG DÒ DẪM QUANH KÉT (17/09/2026).
 *
 * ===== VÌ SAO CẦN =====
 *
 * Trước bản này, nhật ký két chỉ ghi lượt mở THÀNH CÔNG. Lượt bị từ chối — thử mở một ngăn mà
 * ma trận quyền không cho — không để lại dòng nào, ở bất kỳ bảng nào: `assertCanReveal` ném
 * trước khi `vault.reveal()` chạy, mà dòng audit lại nằm bên trong hàm đó. Nên câu hỏi mà một
 * hàng rào PHÁT HIỆN phải trả lời — "có ai đang dò dẫm quanh két không" — không có dữ liệu.
 *
 * Nay mỗi lượt bị từ chối ghi `vault.secret.reveal_denied`, và đủ ngưỡng thì gửi thư cho
 * SA + Admin.
 *
 * ===== BA THAM SỐ, VÀ VÌ SAO CHỌN NHƯ VẬY =====
 *
 * `probe_alert_threshold = 3` — chủ dự án chọn: ba lần là đủ để không còn là tai nạn.
 *
 * `probe_window_minutes = 15` — ba lần RẢI RÁC trong một ngày làm việc không phải dấu hiệu gì:
 * gõ nhầm mã 6 số một lần sáng, một lần chiều là chuyện thường ngày. Chỉ ba lần DỒN vào một
 * khoảng ngắn mới đáng gọi người dậy.
 *
 * `probe_cooldown_minutes = 60` — không có nó thì chính cái cảnh báo thành công cụ tấn công:
 * bắn liên tục vài trăm lượt là hộp thư của mọi quản trị viên ngập, thư thật chìm nghỉm, và
 * người ta tắt thông báo. Một lá cho mỗi đợt là đủ để họ vào xem nhật ký — nơi có đầy đủ chi tiết.
 *
 * Đặt ngưỡng về 0 là TẮT cảnh báo mà VẪN ghi nhật ký — đường lùi không cần sửa code.
 */
INSERT INTO system_config (key, value, description) VALUES
  ('secret.probe_alert_threshold', '3',
   'Bao nhiêu lượt thất bại quanh két (bị từ chối quyền HOẶC gõ sai mã 6 số) thì gửi thư cảnh báo cho SA/Admin. 0 = tắt cảnh báo, vẫn ghi nhật ký'),
  ('secret.probe_window_minutes', '15',
   'Đếm số lượt thất bại trong bao nhiêu phút gần nhất, theo từng người'),
  ('secret.probe_cooldown_minutes', '60',
   'Sau một lá cảnh báo thì im bao nhiêu phút với cùng người đó — chống làm ngập hộp thư quản trị')
ON CONFLICT (key) DO NOTHING;

/*
 * Bảng `audit_log` không đánh chỉ mục theo (actor, action, created_at), mà bộ đếm chạy ở MỖI
 * lượt thất bại. Với một bảng chỉ-thêm sẽ lớn mãi, thiếu chỉ mục thì mỗi lần từ chối là một
 * lượt quét toàn bảng — và đường bị tấn công lại chính là đường tốn kém nhất.
 */
CREATE INDEX IF NOT EXISTS audit_log_actor_action_at_idx
  ON audit_log (actor, action, created_at DESC);

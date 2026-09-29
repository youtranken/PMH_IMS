-- Q-15: yêu cầu mở két chờ quá N giờ mà không ai quyết thì tự hết hạn. Người xin không phải
-- canh trang, nhưng một yêu cầu treo mãi thì lúc được duyệt người xin đã không còn cần, và nó
-- chặn họ gửi yêu cầu mới cho cùng đối tượng. N là luật vận hành của phòng IT (AD-11), phải lớn
-- hơn `approval.reminder_hours` để thư nhắc người duyệt kịp đi trước.
INSERT INTO system_config (key, value, description) VALUES
  ('breakglass.pending_expire_hours', '8',
   'Số giờ một yêu cầu mở két được chờ duyệt; quá hạn thì tự hết hạn và báo người xin')
ON CONFLICT (key) DO NOTHING;

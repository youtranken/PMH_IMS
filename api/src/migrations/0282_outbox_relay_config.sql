-- BE-20 (AD-11): trần số lần relay thử lại một sự kiện outbox ra khỏi code. Seed đúng bằng
-- hằng số cũ (14 lần ≈ 24 giờ với lease tăng gấp đôi) nên hành vi không đổi.
INSERT INTO system_config (key, value, description) VALUES
  ('outbox.max_relay_attempts', '14',
   'Số lần hỏng tối đa trước khi relay bỏ một sự kiện outbox (chỉ requeue tay mới hồi sinh)')
ON CONFLICT (key) DO NOTHING;

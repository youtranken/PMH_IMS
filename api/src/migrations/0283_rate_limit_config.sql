-- BE-20 (AD-11): ba trần theo phút từng viết cứng trong `@Throttle` ra khỏi code. Seed đúng bằng
-- số cũ nên hành vi không đổi; mỗi trần đếm THEO USER.
INSERT INTO system_config (key, value, description) VALUES
  ('rate.totp_per_minute', '10',
   'Số lần gõ mã 2 lớp tối đa mỗi phút mỗi người (đăng nhập, cài lại 2 lớp, xác thực lại)'),
  ('rate.secret_reveal_per_minute', '30',
   'Số lần mở xem mật khẩu trong két tối đa mỗi phút mỗi người'),
  ('rate.file_upload_per_minute', '20',
   'Số lần tải tệp lên tối đa mỗi phút mỗi người')
ON CONFLICT (key) DO NOTHING;

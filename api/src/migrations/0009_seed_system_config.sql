-- AD-10: seed tham số vận hành là migration, không cài tay.
-- AD-11: đây là NƠI DUY NHẤT giữ hằng số nghiệp vụ — code đọc qua SystemConfigService.
INSERT INTO system_config (key, value, description) VALUES
  ('session.idle_minutes',        '30',   'Phiên chết sau bao nhiêu phút không hoạt động (NFR-01)'),
  ('session.absolute_hours',      '12',   'Trần tuyệt đối của một phiên, tính từ lúc đăng nhập (NFR-01)'),
  ('login.max_failed_attempts',   '5',    'Sai liên tiếp bao nhiêu lần thì khóa tài khoản (NFR-01)'),
  ('login.lockout_minutes',       '15',   'Khóa bao nhiêu phút rồi tự mở (NFR-01)'),
  ('login.rate_limit_per_ip',     '20',   'Số lần thử đăng nhập tối đa mỗi IP trong 1 phút (NFR-01)'),
  ('secret.reveal_seconds',       '30',   'Secret hiện bao nhiêu giây rồi tự ẩn (FR-022)'),
  ('secret.stepup_grace_minutes', '10',   'Gõ TOTP một lần dùng được bao lâu trước khi phải gõ lại (FR-022)'),
  ('breakglass.max_grant_hours',  '24',   'Trần thời hạn của một grant break-glass (FR-023)'),
  ('mail.from_address',           '"ims@pmh.com.vn"', 'Địa chỉ gửi của hệ thống'),
  ('app.timezone',                '"Asia/Ho_Chi_Minh"', 'Múi giờ hiển thị (spine: lưu UTC, hiện giờ VN)')
ON CONFLICT (key) DO NOTHING;

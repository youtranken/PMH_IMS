-- Code review Epic 4, finding 1: `POST /auth/step-up` là cửa DUY NHẤT vào cả két sắt, nhưng
-- gõ sai mã chỉ ghi audit chứ không đếm. Kẻ cầm cookie phiên trộm được có thể thử mã liên
-- tục cho tới khi trúng, và không có gì chặn lại ngoài trần rate-limit chung.
--
-- Đếm trên PHIÊN chứ không trên tài khoản là có chủ ý: khóa tài khoản thì kẻ tấn công cầm
-- cookie trộm chỉ cần gõ sai vài lần là KHÓA được người dùng thật ra ngoài — biến hàng rào
-- thành công cụ phá hoại. Thu hồi phiên thì kẻ tấn công mất cookie, còn người dùng thật chỉ
-- việc đăng nhập lại bằng mật khẩu + TOTP.
ALTER TABLE sessions ADD COLUMN stepup_failures integer NOT NULL DEFAULT 0;

-- AD-11: ngưỡng vào system_config, không viết cứng trong code.
INSERT INTO system_config (key, value, description)
VALUES (
  'secret.stepup_max_failures',
  '5',
  'Gõ sai mã step-up bao nhiêu lần liên tiếp thì thu hồi phiên (buộc đăng nhập lại).'
)
ON CONFLICT (key) DO NOTHING;

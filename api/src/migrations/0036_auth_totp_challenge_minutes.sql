-- auth.totp_challenge_minutes (Q-20): phiên đã đúng mật khẩu nhưng chưa nhập mã 2 lớp chỉ sống
-- ngần này phút kể từ lúc tạo. Không áp cho luồng cài 2 lớp bắt buộc.
INSERT INTO system_config (key, value, description) VALUES
  ('auth.totp_challenge_minutes', '5', 'Đã đúng mật khẩu thì phải nhập mã 2 lớp trong bao nhiêu phút (tính từ lúc nhập mật khẩu). Quá hạn thì phải đăng nhập lại. Không áp cho lần cài 2 lớp đầu tiên');

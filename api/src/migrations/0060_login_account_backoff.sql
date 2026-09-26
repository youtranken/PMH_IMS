-- SEC-02/03 (QUYET-DINH Q-06): chặn đăng nhập theo TÀI KHOẢN, chậm dần.
-- Mỗi lượt sai mật khẩu hoặc sai mã TOTP lúc đăng nhập cộng vào users.failed_attempts;
-- cứ đủ login.max_failed_attempts lượt thì phải chờ lần lượt các bậc dưới đây (phút).
INSERT INTO system_config (key, value, description) VALUES
  ('login.account_backoff_minutes', '"5,15,30,60"',
   'Chặn theo tài khoản: cứ đủ login.max_failed_attempts lượt sai thì chờ lần lượt bao nhiêu phút; bậc cuối lặp lại');

-- Trước bản này users.locked_until chỉ là cửa sổ chống gửi thư lặp, không chặn ai. Nay nó chặn,
-- nên xoá giá trị cũ để không ai bị chặn vì một bộ đếm mang nghĩa khác.
UPDATE users SET failed_attempts = 0, locked_until = NULL;

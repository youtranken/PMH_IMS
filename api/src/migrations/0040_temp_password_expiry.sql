-- Mật khẩu tạm có hạn (Q-20). Hàng có mốc hạn = mật khẩu SA cấp qua màn Người dùng IMS (tạo tài
-- khoản / đặt lại), người dùng chưa đổi. NULL = không có hạn: mật khẩu người dùng tự đặt, hoặc
-- SA dựng bằng seed-sa — hệ thống chưa có SA nào khác để đặt lại, nên mật khẩu đó mà hết hạn
-- trước lần đăng nhập đầu thì không còn đường vào. Không điền ngược cho hàng cũ vì cùng lý do.
ALTER TABLE users ADD COLUMN temp_password_expires_at timestamptz;

INSERT INTO system_config (key, value, description) VALUES
  ('auth.temp_password_hours', '24', 'Mật khẩu tạm (tạo tài khoản, đặt lại mật khẩu) dùng được trong bao nhiêu giờ. Quá hạn thì không đăng nhập được, SA phải đặt lại');

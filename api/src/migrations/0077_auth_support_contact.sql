-- Q-14: người quên mật khẩu hoặc mất điện thoại 2 lớp được chỉ tới người quản trị. Màn đăng nhập
-- đọc câu này khi CHƯA đăng nhập, nên chỉ ghi thông tin liên hệ công khai trong nội bộ.
INSERT INTO system_config (key, value, description) VALUES
  ('auth.support_contact',
   '"Liên hệ Super Admin phòng IT (gặp trực tiếp hoặc gọi số nội bộ của phòng IT)."',
   'Câu hướng dẫn liên hệ hiện ở màn đăng nhập khi quên mật khẩu hoặc mất mã 2 lớp (đọc được khi chưa đăng nhập)');

-- Hai ngưỡng cho ba khối mới của bảng điều khiển (story 7.1 mở rộng).
--
-- `dashboard.subnet_full_percent = 80`
--   Dải /24 còn ~50 địa chỉ trống là lúc bắt đầu phải nghĩ tới việc chia dải mới, chứ không
--   phải lúc còn 2 địa chỉ — xin một dải mới ở PMH đi qua nhà mạng và mất vài ngày. 80% cho
--   đúng khoảng đệm đó. Siết xuống 70 khi công ty mở thêm site thì chỉ cần một dòng UPDATE.
--
-- `dashboard.secret_stale_days = 180`
--   Nửa năm. Cố ý KHÔNG phải 90: IMS không ép xoay mật khẩu theo lịch (NIST 800-63B từ 2017 đã
--   bỏ khuyến nghị đó — xoay theo lịch đẻ ra `Matkhau2026!` rồi `Matkhau2027!`). Con số này chỉ
--   để trả lời "ngăn nào lâu quá không ai đụng tới", một câu hỏi rà soát, không phải một hạn chót.
--
-- AD-11: sửa giá trị ở đây, không sửa hằng số trong code.
INSERT INTO system_config (key, value, description) VALUES
  ('dashboard.subnet_full_percent', '80',  'Dải mạng dùng từ bao nhiêu phần trăm trở lên thì lên bảng điều khiển (FR-020)'),
  ('dashboard.secret_stale_days',   '180', 'Két lâu bao nhiêu ngày không đổi thì coi là cũ, lên bảng điều khiển')
ON CONFLICT (key) DO NOTHING;

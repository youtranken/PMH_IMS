-- BE-20 (AD-11): hai tham số hiển thị của màn Sắp hết hạn và trang chủ ra khỏi code. Giá trị
-- seed đúng bằng hằng số cũ nên hành vi không đổi.
INSERT INTO system_config (key, value, description) VALUES
  ('expiry.look_back_days', '365',
   'Màn Sắp hết hạn nhìn lùi bao nhiêu ngày để bắt mục đã quá hạn; cũng là trần của email nhắc'),
  ('dashboard.max_items', '8',
   'Số dòng tối đa mỗi khối của trang chủ')
ON CONFLICT (key) DO NOTHING;

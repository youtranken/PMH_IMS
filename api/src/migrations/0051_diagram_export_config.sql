-- Tham số xuất PNG/PDF bản vẽ (AD-11, FR-044). Chỉ seed system_config.
INSERT INTO system_config (key, value, description) VALUES
  ('diagram.export_max_megapixels', '40', 'Số triệu điểm ảnh tối đa của một file xuất PNG/PDF bản vẽ; lớn hơn thì hạ độ nét, vượt cả ở độ nét thường thì từ chối'),
  ('diagram.export_timeout_seconds', '30', 'Xuất PNG/PDF một bản vẽ quá chừng này giây thì báo lỗi thay vì treo');

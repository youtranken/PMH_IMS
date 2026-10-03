-- Tham số trình vẽ sơ đồ mạng (AD-17, AD-11). Chỉ seed system_config.
INSERT INTO system_config (key, value, description) VALUES
  ('diagram.editor_init_timeout_seconds', '20', 'Trình vẽ sơ đồ không sẵn sàng trong bao nhiêu giây thì màn báo "Trình vẽ chưa sẵn sàng" kèm nút thử lại'),
  ('diagram.xml_max_kb', '2048', 'Dung lượng tối đa của XML một bản vẽ (KB). Lưu bản lớn hơn bị từ chối'),
  ('diagram.svg_max_kb', '4096', 'Dung lượng tối đa của ảnh SVG một bản vẽ dùng để xem (KB)'),
  ('diagram.max_cells', '5000', 'Số ô (hình + dây) tối đa của một bản vẽ');

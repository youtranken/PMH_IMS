-- AD-10: seed là migration, không cài tay trên từng máy.
--
-- CHỈ seed `device_type` — đây là danh mục chung của mọi công ty. Site / tủ mạng / nhà cung cấp
-- là dữ liệu riêng của PMH: 2026-08-22 anh Thuận xác nhận chưa chốt, sẽ điền vào
-- `mau-danh-muc.xlsx` rồi import qua màn Danh mục (story 2.1). Seed sẵn dữ liệu đoán mò
-- chỉ tạo rác phải đi xóa.
--
-- `has_port_map = true` = trang chi tiết thiết bị loại đó hiện bảng port map (FR-006).
INSERT INTO device_type (name, has_port_map, description) VALUES
  ('Switch',         true,  'Thiết bị chuyển mạch — trang chi tiết có bảng port map'),
  ('Firewall',       true,  'Router/tường lửa biên — gắn hồ sơ ISP và sổ NAT'),
  ('Server',         true,  'Máy chủ vật lý'),
  ('NAS',            true,  'Thiết bị lưu trữ mạng'),
  ('UPS',            true,  'Bộ lưu điện'),
  ('Access Point',   false, 'Điểm phát Wi-Fi'),
  ('PC',             false, 'Máy trạm người dùng'),
  ('Laptop',         false, 'Máy tính xách tay'),
  ('Printer',        false, 'Máy in / máy scan'),
  ('Camera',         false, 'Camera giám sát'),
  ('Điện thoại IP',  false, 'Máy nhánh IP'),
  ('Thiết bị khác',  false, 'Không thuộc các loại trên')
ON CONFLICT (name) DO NOTHING;

-- device_type — chủ: catalog. `has_port_map`: loại có bảng port map (FR-006). `is_router`: ô
-- Router của sổ NAT chỉ liệt kê loại mang cờ này (Q-14).
CREATE TABLE device_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    has_port_map boolean DEFAULT false NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_router boolean DEFAULT false NOT NULL,
    CONSTRAINT device_type_name_key UNIQUE (name),
    CONSTRAINT device_type_pkey PRIMARY KEY (id)
);

-- Điểm xuất phát cho ô chọn; người quản trị sửa/tắt ở màn Danh mục.
INSERT INTO device_type (name, has_port_map, description, active, is_router) VALUES
  ('Switch', true, 'Thiết bị chuyển mạch — trang chi tiết có bảng port map', true, false),
  ('Server', true, 'Máy chủ vật lý', true, false),
  ('NAS', true, 'Thiết bị lưu trữ mạng', true, false),
  ('UPS', true, 'Bộ lưu điện', true, false),
  ('Access Point', false, 'Điểm phát Wi-Fi', true, false),
  ('PC', false, 'Máy trạm người dùng', true, false),
  ('Laptop', false, 'Máy tính xách tay', true, false),
  ('Printer', false, 'Máy in / máy scan', true, false),
  ('Camera', false, 'Camera giám sát', true, false),
  ('Điện thoại IP', false, 'Máy nhánh IP', true, false),
  ('Thiết bị khác', false, 'Không thuộc các loại trên', true, false),
  ('Firewall', true, 'Router/tường lửa biên — gắn hồ sơ ISP và sổ NAT', true, true);

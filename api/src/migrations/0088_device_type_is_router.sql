-- NET-041 (Q-14): cờ "Router/Firewall" trên loại thiết bị. Ô Router của sổ NAT chỉ liệt kê thiết
-- bị thuộc loại mang cờ này — chọn nhầm một camera làm router là dữ liệu sai mà không ai phát hiện.
-- Cùng kiểu với has_port_map: cờ của DANH MỤC, sửa ở màn Danh mục, không đoán theo tên lúc chạy.
ALTER TABLE device_type ADD COLUMN is_router boolean NOT NULL DEFAULT false;

-- Gieo cho các loại đang có mà tên đã nói rõ là router/tường lửa (seed 0011 có 'Firewall').
-- Loại khác thì người quản trị tự bật ở Danh mục.
UPDATE device_type SET is_router = true
 WHERE name::text ILIKE '%router%' OR name::text ILIKE '%firewall%';

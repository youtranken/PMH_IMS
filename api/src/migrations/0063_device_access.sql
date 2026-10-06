-- Truy cập quản trị của thiết bị (Q-26) — chủ: devices (AD-3). Danh sách nhỏ (tối đa 10 dòng) kiểu +
-- địa chỉ + cổng, luôn đọc/ghi cùng hồ sơ máy nên để jsonb trên chính hàng `device` thay vì một bảng
-- con. Luật từng dòng ở `normalizeAccessPoints` (api); CHECK chỉ giữ hình dạng mảng. Không có mật
-- khẩu ở đây — mật khẩu nằm ở Két.
ALTER TABLE device
    ADD COLUMN access_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD CONSTRAINT device_access_points_array_check CHECK ((jsonb_typeof(access_points) = 'array'));

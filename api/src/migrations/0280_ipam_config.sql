-- BE-20 (AD-11): hai ngưỡng của mảng IP ra khỏi code. Giá trị seed đúng bằng hằng số cũ nên
-- hành vi không đổi; phòng IT siết/nới trên màn Tham số hệ thống.
INSERT INTO system_config (key, value, description) VALUES
  ('ipam.subnet_min_prefix', '24',
   'Dải rộng nhất được khai (độ dài prefix). Chỉ siết, không nới dưới 24: màn dải liệt kê mọi host một lượt'),
  ('nat.wide_port_range', '1000',
   'Luật NAT mở dải cổng ngoài rộng hơn ngần này thì cảnh báo (không chặn)')
ON CONFLICT (key) DO NOTHING;

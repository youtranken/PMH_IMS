-- Story 2.4 (FR-006, AD-14): bảng port map.
--
-- MỘT KẾT NỐI = MỘT BẢN GHI. Cắm switch R01 cổng 12 sang server SRV-APP-01 thì chỉ ghi
-- một dòng ở phía switch; trang của SRV-APP-01 hiện chiều ngược bằng QUERY
-- (`connected_device_id = <id>`), KHÔNG tạo bản ghi đối xứng. Hai bản ghi cho một sợi dây
-- là con đường chắc chắn dẫn tới hai đầu mô tả khác nhau sau vài tháng.
CREATE TABLE device_port (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id           uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  port_label          text NOT NULL,
  -- Đầu kia NẰM TRONG KHO thiết bị…
  connected_device_id uuid REFERENCES device (id) ON DELETE RESTRICT,
  -- …hoặc chỉ là mô tả tự do ("máy in phòng Kế toán", "uplink nhà mạng").
  connected_label     text,
  -- Cổng ở đầu kia, nếu biết (vd "Gi1/0/24").
  connected_port      text,
  used_by             text,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Một thiết bị không thể có hai dòng cho cùng một cổng.
  CONSTRAINT device_port_label_key UNIQUE (device_id, port_label),
  -- Cắm thiết bị vào chính nó là lỗi gõ, chặn ngay ở DB.
  CONSTRAINT device_port_not_self_check
    CHECK (connected_device_id IS NULL OR connected_device_id <> device_id)
);

CREATE INDEX device_port_device_idx ON device_port (device_id);
-- Chiều ngược: "cổng nào ở nơi khác đang cắm vào thiết bị này" — query chạy trên index này.
CREATE INDEX device_port_connected_idx ON device_port (connected_device_id)
  WHERE connected_device_id IS NOT NULL;

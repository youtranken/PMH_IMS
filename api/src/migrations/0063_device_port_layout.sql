-- Cổng mẫu của model và danh sách cổng vật lý của từng máy (Q-26) — chủ: devices (AD-3).
--
-- Danh sách cổng KHÁC `device_port`: mỗi hàng `device_port` là MỘT SỢI DÂY (ghi ở một phía), còn
-- đây là các lỗ cổng máy có. Sinh 48 hàng dây rỗng cho một switch sẽ đổi nghĩa sơ đồ cổng, file xuất
-- và phép tính dây của sơ đồ, nên cổng vật lý nằm ở jsonb trên hàng `device` và "đang dùng" được tính
-- bằng cách ghép với các dây có thật.
--
-- Máy chép cổng mẫu của model LÚC GÁN model: đổi mẫu sau đó không đổi ngầm máy đã có.
ALTER TABLE device_model
    ADD COLUMN port_template jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD CONSTRAINT device_model_port_template_array_check CHECK ((jsonb_typeof(port_template) = 'array'));
ALTER TABLE device
    ADD COLUMN port_layout jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD CONSTRAINT device_port_layout_array_check CHECK ((jsonb_typeof(port_layout) = 'array'));
INSERT INTO system_config (key, value, description) VALUES
  ('device.port_template_max', '256', 'Số cổng tối đa một máy có (cổng mẫu của model sinh ra, cộng cổng riêng) — chặn mẫu gõ nhầm sinh hàng nghìn cổng');

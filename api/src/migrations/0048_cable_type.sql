-- cable_type — chủ: catalog (AD-3). Loại dây trên sơ đồ cổng và sơ đồ mạng (Q-23).
--
-- Màu dây KHÔNG lưu mã màu: `color_slot` trỏ vào ô màu `--diagram-cable-<n>` của `tokens.css`
-- (có cặp dark), để đổi theme hay đổi bảng màu không phải sửa dữ liệu, và không ai gõ được một mã
-- hex tự do vào danh mục. Trần 8 = số ô màu khai trong `tokens.css`.
CREATE TABLE cable_type (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    color_slot integer NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cable_type_color_slot_check CHECK (color_slot BETWEEN 1 AND 8),
    CONSTRAINT cable_type_name_key UNIQUE (name),
    CONSTRAINT cable_type_pkey PRIMARY KEY (id)
);

-- Đúng ba loại chủ dự án chốt (Q-23); SA thêm loại khác ở màn Danh mục.
INSERT INTO cable_type (name, color_slot, description) VALUES
  ('Cat6', 1, 'Cáp đồng xoắn đôi Cat6'),
  ('Fiber', 2, 'Cáp quang'),
  ('DAC', 3, 'Cáp đồng gắn sẵn đầu SFP (Direct Attach Copper)');

-- Lịch sử danh mục nhận thêm loại mục mới.
ALTER TABLE catalog_history DROP CONSTRAINT catalog_history_entity_check;
ALTER TABLE catalog_history ADD CONSTRAINT catalog_history_entity_check
    CHECK ((entity = ANY (ARRAY['site'::text, 'cabinet'::text, 'device_type'::text, 'vendor'::text, 'department'::text, 'isp_provider'::text, 'service_port'::text, 'cable_type'::text])));

-- device_port.cable_type_id — chủ: devices. NULL = chưa khai loại dây (mọi dòng có từ trước).
-- RESTRICT: loại đang dùng không xoá được, chỉ ngừng dùng (Q-14) — dây cũ vẫn giữ màu.
ALTER TABLE device_port ADD COLUMN cable_type_id uuid;
ALTER TABLE device_port ADD CONSTRAINT device_port_cable_type_id_fkey
    FOREIGN KEY (cable_type_id) REFERENCES cable_type(id) ON DELETE RESTRICT;

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.autolayout_max_nodes', '300', 'Số thiết bị tối đa một lần "Dựng nháp từ sơ đồ cổng"; nhiều hơn thì thu hẹp phạm vi');

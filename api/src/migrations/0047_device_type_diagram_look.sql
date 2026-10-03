-- Hình của loại thiết bị trên sơ đồ mạng (AD-18: XML bản vẽ lưu "khô", biểu tượng hydrate từ đây
-- mỗi lần mở) — chủ: catalog (AD-3).
--
-- `diagram_shape`: tên stencil draw.io chọn trong danh sách ĐÓNG của `catalog/diagram-shapes.ts`;
-- NULL = hình "Thiết bị khác". CHECK chỉ giữ dạng tên (không có ký tự nào cắt được chuỗi style
-- `k=v;` của draw.io): danh sách hình đổi theo bản draw.io ghim, nên kiểm tên cụ thể ở tầng API.
ALTER TABLE device_type ADD COLUMN diagram_shape text;
ALTER TABLE device_type ADD CONSTRAINT device_type_diagram_shape_check
    CHECK (diagram_shape IS NULL OR diagram_shape ~ '^mxgraph\.[a-z0-9_]+(\.[a-z0-9_]+)+$');

-- Biểu tượng SVG riêng do SA tải lên, ĐÃ LỌC phía server (`common/svg-sanitize.ts`). Bảng riêng
-- thay vì cột của `device_type`: danh sách danh mục đổ vào mọi ô chọn của mọi form, không được
-- kéo theo tới 100 KB SVG mỗi loại. Không qua module `files`: tệp nằm trên volume và phải đọc
-- lại từ đĩa ở mỗi lần mở bản vẽ, còn biểu tượng nhỏ, đã lọc, và cần đi cùng một câu SELECT.
CREATE TABLE device_type_icon (
    device_type_id uuid NOT NULL,
    svg text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_type_icon_pkey PRIMARY KEY (device_type_id),
    CONSTRAINT device_type_icon_device_type_id_fkey FOREIGN KEY (device_type_id) REFERENCES device_type(id) ON DELETE CASCADE
);

-- Loại có sẵn từ đầu nhận hình hợp với tên; loại người dùng tự tạo để trống ("Thiết bị khác").
UPDATE device_type SET diagram_shape = s.shape
  FROM (VALUES
    ('Switch', 'mxgraph.networks.switch'),
    ('Server', 'mxgraph.networks.server'),
    ('NAS', 'mxgraph.networks.nas_filer'),
    ('UPS', 'mxgraph.networks.ups_small'),
    ('Access Point', 'mxgraph.networks.wireless_hub'),
    ('PC', 'mxgraph.networks.pc'),
    ('Laptop', 'mxgraph.networks.laptop'),
    ('Printer', 'mxgraph.networks.printer'),
    ('Camera', 'mxgraph.networks.security_camera'),
    ('Điện thoại IP', 'mxgraph.cisco.modems_and_phones.ip_phone'),
    ('Firewall', 'mxgraph.networks.firewall')
  ) AS s(name, shape)
 WHERE device_type.name = s.name AND device_type.diagram_shape IS NULL;

INSERT INTO system_config (key, value, description) VALUES
  ('diagram.icon_svg_max_kb', '100', 'Dung lượng tối đa của biểu tượng SVG riêng tải lên cho một loại thiết bị (KB)');

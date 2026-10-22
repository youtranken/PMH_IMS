-- Biểu tượng và ảnh riêng của loại thiết bị trên GIAO DIỆN IMS (PW-A18, Q-33) — chủ: catalog (AD-3).
-- Khác hình trên sơ đồ mạng (0047): đây là thứ khung ảnh trống của thiết bị hiện ra khi máy và
-- model chưa có ảnh thật.
--
-- `icon`: tên một biểu tượng trong danh sách ĐÓNG của `catalog/device-type-icons.ts` (web vẽ
-- đúng danh sách đó); NULL = biểu tượng "thiết bị chung". CHECK chỉ giữ dạng tên — danh sách cụ
-- thể kiểm ở tầng API, như `diagram_shape`.
--
-- `photo_file_id`: ảnh tải lên (tệp `files` mang `owner_type = 'device_type'`) thắng biểu tượng.
-- Không có khoá ngoại sang `file`, cùng lý do với `device.photo_*_file_id` (0054): `file` chỉ xoá
-- mềm, service coi ảnh đã xoá như chưa chọn.
ALTER TABLE device_type
    ADD COLUMN icon text,
    ADD COLUMN photo_file_id uuid,
    ADD CONSTRAINT device_type_icon_check CHECK (icon IS NULL OR icon ~ '^[a-z][a-z_]{0,31}$');

UPDATE device_type SET icon = s.icon
  FROM (VALUES
    ('Switch', 'switch'),
    ('Server', 'server'),
    ('NAS', 'nas'),
    ('UPS', 'ups'),
    ('Access Point', 'access_point'),
    ('PC', 'pc'),
    ('Laptop', 'laptop'),
    ('Printer', 'printer'),
    ('Camera', 'camera'),
    ('Điện thoại IP', 'phone'),
    ('Firewall', 'firewall')
  ) AS s(name, icon)
 WHERE device_type.name = s.name AND device_type.icon IS NULL;

ALTER TABLE file DROP CONSTRAINT file_owner_type_check;
ALTER TABLE file ADD CONSTRAINT file_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'isp'::text, 'software'::text, 'service_account'::text, 'subnet'::text, 'nat_rule'::text, 'device_model'::text, 'software_seat'::text, 'iso_period'::text, 'iso_incident'::text, 'device_type'::text])));

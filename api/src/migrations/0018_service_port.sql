-- service_port — chủ: catalog. Cổng dịch vụ đặt tên sẵn cho form NAT.
CREATE TABLE service_port (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    protocol text DEFAULT 'tcp'::text NOT NULL,
    port_from integer NOT NULL,
    port_to integer NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_port_protocol_check CHECK ((protocol = ANY (ARRAY['tcp'::text, 'udp'::text, 'both'::text]))),
    CONSTRAINT service_port_range_check CHECK (port_from BETWEEN 1 AND 65535 AND port_to BETWEEN 1 AND 65535 AND port_to >= port_from),
    CONSTRAINT service_port_name_key UNIQUE (name),
    CONSTRAINT service_port_pkey PRIMARY KEY (id)
);

-- Điểm xuất phát cho ô chọn; người quản trị sửa/tắt ở màn Danh mục.
INSERT INTO service_port (name, protocol, port_from, port_to, description, active) VALUES
  ('HTTP', 'tcp', 80, 80, 'Web không mã hóa', true),
  ('HTTPS', 'tcp', 443, 443, 'Web có mã hóa', true),
  ('RDP', 'tcp', 3389, 3389, 'Remote Desktop — cân nhắc kỹ trước khi mở ra Internet', true),
  ('SSH', 'tcp', 22, 22, 'Quản trị dòng lệnh', true),
  ('OpenVPN', 'udp', 1194, 1194, 'VPN', true),
  ('PPTP VPN', 'tcp', 1723, 1723, 'VPN kiểu cũ của Draytek', true),
  ('NAS Web', 'tcp', 5001, 5001, 'Giao diện web của NAS Synology', true),
  ('SMTP', 'tcp', 25, 25, 'Gửi mail', true),
  ('DNS', 'both', 53, 53, 'Phân giải tên miền', true);

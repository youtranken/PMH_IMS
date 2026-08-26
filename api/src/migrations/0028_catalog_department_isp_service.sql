-- Ba danh mục mới — chủ sở hữu: module `catalog` (AD-3), cùng nếp với site/tủ/loại/NCC.
--
-- Vì sao cả ba: đây là những ô người dùng đang GÕ TAY TỰ DO, và gõ mỗi nơi một kiểu. "P. Kế
-- toán" / "Phòng Kế toán" / "KT" là ba bộ phận khác nhau đối với máy, nên lọc ra thiếu và báo
-- cáo cộng nhầm — thứ chỉ lộ ra khi ai đó đối chiếu tay và thấy con số không khớp.

-- 1) Bộ phận / phòng ban.
--
-- Ô này đang gõ tay ở BỐN chỗ: `device.department`, `ip_address.used_by`, `nat_rule.used_by`,
-- và `device_port.used_by`. Bốn chỗ đó cùng trả lời một câu "ai đang dùng", nên phải cùng
-- một danh sách thì mới tra chéo được.
CREATE TABLE department (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext NOT NULL UNIQUE,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2) Nhà mạng (ISP).
--
-- Tách khỏi `vendor` chứ không dùng lại: nhà cung cấp thiết bị và nhà mạng nằm ở hai ô chọn
-- khác nhau, gộp chung thì ô "Nhà mạng" phải cuộn qua cả chục công ty bán switch. `hotline`
-- ở đây là số gọi khi đứt cáp lúc 2 giờ sáng — đúng lý do Epic 5 có màn đường truyền.
CREATE TABLE isp_provider (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       citext NOT NULL UNIQUE,
  hotline    text,
  contact    text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Dịch vụ / port.
--
-- Sổ NAT đang bắt gõ số port trần: một dòng ghi "5001" thì sáu tháng sau không ai biết đó là
-- NAS hay là gì, và cũng không ai dám đóng. Khai một lần "NAS Web · TCP · 5001" rồi chọn lại
-- là cách duy nhất để cột port tự nói ra nó là dịch vụ gì.
--
-- Có `port_from`/`port_to` chứ không phải một số: dải port camera (50000-52000) là việc có
-- thật, và sổ NAT vốn đã nhận dải rồi.
CREATE TABLE service_port (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext NOT NULL UNIQUE,
  protocol    text NOT NULL DEFAULT 'tcp',
  port_from   integer NOT NULL,
  port_to     integer NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_port_protocol_check CHECK (protocol IN ('tcp', 'udp', 'both')),
  CONSTRAINT service_port_range_check CHECK (
    port_from BETWEEN 1 AND 65535
    AND port_to BETWEEN 1 AND 65535
    AND port_to >= port_from
  )
);

-- Bộ khởi đầu để ô chọn không rỗng ngay ngày đầu — một danh sách trắng thì người dùng lại gõ
-- tay, và cái vòng cũ lặp lại. `ON CONFLICT DO NOTHING` để chạy lại migration trên DB đã có
-- dữ liệu cũng không sao (AD-10: chỉ tiến, và phải chạy sạch trên DB trắng).
INSERT INTO service_port (name, protocol, port_from, port_to, description) VALUES
  ('HTTP',       'tcp', 80,    80,    'Web không mã hóa'),
  ('HTTPS',      'tcp', 443,   443,   'Web có mã hóa'),
  ('RDP',        'tcp', 3389,  3389,  'Remote Desktop — cân nhắc kỹ trước khi mở ra Internet'),
  ('SSH',        'tcp', 22,    22,    'Quản trị dòng lệnh'),
  ('OpenVPN',    'udp', 1194,  1194,  'VPN'),
  ('PPTP VPN',   'tcp', 1723,  1723,  'VPN kiểu cũ của Draytek'),
  ('NAS Web',    'tcp', 5001,  5001,  'Giao diện web của NAS Synology'),
  ('SMTP',       'tcp', 25,    25,    'Gửi mail'),
  ('DNS',        'both', 53,   53,    'Phân giải tên miền')
ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- GIEO DỮ LIỆU DEMO — CHỈ DÙNG Ở MÁY DEV. KHÔNG BAO GIỜ CHẠY TRÊN PROD.
-- =====================================================================
--
-- Sinh ra để trả lời một câu mà DB dev gần trống không trả lời được:
-- **giao diện trông thế nào khi có vài chục nghìn hồ sơ?** Bảng dài, phân
-- trang thật, ô tìm trên dữ liệu thật, bản đồ quan hệ nhiều nhánh, và
-- `Xuất Excel` trên một bảng 30k dòng.
--
-- ===== HAI LUẬT PHẢI NHỚ =====
--
-- 1. **KHÔNG hàng nào mang chữ `E2E`.** Đó là dấu DUY NHẤT mà
--    `api/scripts/reset-e2e.mjs` nhìn vào để dọn. Đặt `E2E` vào đây là
--    lượt dọn kế tiếp xoá mất dữ liệu demo, hoặc tệ hơn — lượt gieo này
--    làm đỏ một bài kiểm khác vài ngày sau.
--    Mọi hàng ở đây mang tiền tố `DM` / `DMS` / `DMSW` / `DMSA`.
--
-- 2. **Dữ liệu demo và bộ E2E KHÔNG sống chung.** 30k thiết bị đẩy hàng
--    của bài kiểm ra khỏi trang 1 và làm đỏ những bài đi tìm dòng vừa
--    tạo. Thứ tự đúng: chạy E2E TRƯỚC, gieo demo SAU. Muốn chạy lại E2E
--    thì `psql -f ops/unseed-demo.sql` trước đã.
--
-- Chạy:
--   docker exec -i it_qlmgmtip-postgres-1 psql -U ims -d ims -v ON_ERROR_STOP=1 < ops/seed-demo.sql
--
-- Gỡ:  ops/unseed-demo.sql
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- Cùng một hạt giống ⇒ hai lượt gieo cho cùng một bộ dữ liệu, so sánh được.
-- KHÔNG có `setseed` ở đây, và chỗ trống này là cố ý (§18 #12, bỏ 22/09).
--
-- Từng có `SELECT setseed(0.42);` với ý "gieo cùng một hạt để lượt gieo tái lập được". Nhưng
-- 305 dòng còn lại của file KHÔNG gọi `random()` lần nào — dữ liệu demo là hằng số viết tay.
-- Cái hại không phải một dòng thừa: nó DẠY người sau rằng thêm `random()` vào đây vẫn tái lập
-- được. Sai — `setseed` chỉ ảnh hưởng `random()` trong CÙNG một phiên, mà lượt gieo này chạy
-- qua `psql` nhiều lần, nhiều phiên.
--
-- Cần ngẫu nhiên mà tái lập được thì gieo lại `setseed` NGAY TRƯỚC mỗi câu dùng `random()`,
-- trong cùng phiên, và nói rõ ra.

-- Mốc thời gian: mọi ngày tháng tính LÙI/TỚI từ hôm nay, để màn "Sắp hết hạn"
-- luôn có nội dung dù gieo lại sau vài tháng.
CREATE TEMP TABLE _now AS SELECT current_date AS d;

-- ---------------------------------------------------------------- SITE
INSERT INTO site (code, name, address, active)
SELECT
  'DMS-' || lpad(n::text, 2, '0'),
  (ARRAY['Trụ sở Nguyễn Văn Linh','Nhà máy Long Thành','Kho Sóng Thần',
         'Chi nhánh Đà Nẵng','Chi nhánh Hà Nội','Xưởng Bình Dương',
         'Trung tâm dữ liệu Tân Thuận','Văn phòng Cần Thơ'])[n],
  (ARRAY['801 Nguyễn Văn Linh, Q7','KCN Long Thành, Đồng Nai','KCN Sóng Thần, Bình Dương',
         '12 Bạch Đằng, Hải Châu','88 Láng Hạ, Đống Đa','KCN VSIP 1, Thuận An',
         'Lô A2 KCX Tân Thuận, Q7','45 Trần Hưng Đạo, Ninh Kiều'])[n],
  n <> 8                                   -- một site đã đóng, để màn Danh mục có dòng tắt
FROM generate_series(1, 8) n;

-- --------------------------------------------------------- NHÀ CUNG CẤP
INSERT INTO vendor (name, supplies, phone, contact, active)
SELECT
  'DM ' || (ARRAY['Cisco Việt Nam','HPE Phân phối','Dell Technologies VN','Fortinet APAC',
                  'Ruijie Networks','Synology VN','APC Schneider','Canon Marketing VN',
                  'Hikvision VN','Lenovo Việt Nam','Aruba Networks','TP-Link VN'])[n],
  (ARRAY['Switch, Router','Server, Storage','PC, Laptop','Firewall','Access Point','NAS',
         'UPS','Printer','Camera','Laptop, PC','Access Point','Switch'])[n],
  '028' || lpad((3000000 + n * 7919)::text, 7, '0'),
  'Anh/chị phụ trách KV phía Nam',
  true
FROM generate_series(1, 12) n;

-- --------------------------------------------------------------- BỘ PHẬN
INSERT INTO department (name, description, active)
SELECT
  'DM ' || (ARRAY['Kế toán','Nhân sự','Kinh doanh','Kỹ thuật','Sản xuất','Kho vận',
                  'Mua hàng','Chất lượng','Bảo trì','R&D','Marketing','Pháp chế',
                  'An toàn lao động','Xuất nhập khẩu','Ban giám đốc'])[n],
  'Bộ phận dữ liệu mẫu',
  true
FROM generate_series(1, 15) n;

-- ------------------------------------------------------------ TỦ MẠNG
-- 12 tủ mỗi site (trừ site đã đóng) = 84 tủ.
INSERT INTO cabinet (site_id, code, description, u_height, active)
SELECT s.id, 'T-' || lpad(c::text, 2, '0'), 'Tủ rack tầng ' || c, 42, true
FROM site s
CROSS JOIN generate_series(1, 12) c
WHERE s.code LIKE 'DMS-%'
  AND s.code <> 'DMS-08';

-- ------------------------------------------------------------- THIẾT BỊ
-- 30.000 hồ sơ. Phân bố trạng thái cố ý lệch giống thực tế:
-- ~78% đang dùng · 12% dự phòng · 6% hỏng · 4% đã thanh lý.
INSERT INTO device (
  code, name, device_type_id, model, serial, site_id, cabinet_id, vendor_id,
  assigned_to, department, purchase_date, warranty_start, warranty_end, status, note
)
SELECT
  'DM-' || lpad(n::text, 6, '0'),
  (ARRAY['Máy trạm','Máy in','Switch tầng','Camera hành lang','Router chi nhánh',
         'Laptop nhân viên','Máy chủ ảo hoá','Bộ lưu điện','Điểm phát sóng',
         'Ổ lưu trữ mạng','Tường lửa','Điện thoại bàn'])[1 + (n % 12)]
    || ' ' || lpad(n::text, 5, '0'),
  dt.id,
  (ARRAY['Catalyst 2960X','ProLiant DL380','OptiPlex 7090','FortiGate 100F','RG-AP840',
         'DS1821+','Smart-UPS 3000','imageRUNNER 2625','DS-2CD2143G2','ThinkPad T14'])[1 + (n % 10)],
  'SN' || lpad(((n::bigint * 104729) % 9000000 + 1000000)::text, 9, '0'),
  st.id,
  cb.id,
  vd.id,
  CASE WHEN n % 5 = 0 THEN NULL
       ELSE (ARRAY['Nguyễn Văn An','Trần Thị Bình','Lê Hoàng Cường','Phạm Thu Dung',
                   'Vũ Minh Đức','Hoàng Thị En','Đặng Quốc Phong','Bùi Thanh Giang'])[1 + (n % 8)]
  END,
  dp.name,
  -- `warranty_end` TRẢI quanh hôm nay (có cái quá hạn, có cái còn vài ngày, có cái còn hai
  -- năm) — đó là thứ làm màn Sắp hết hạn và huy hiệu hạn có việc để làm.
  -- `warranty_start` và `purchase_date` thì tính LÙI TỪ `warranty_end`, không tính độc lập:
  -- CHECK `warranty_end >= warranty_start` của bảng bắt ngay lượt đầu khi tôi thử cách kia.
  (SELECT d FROM _now) + ((n * 37) % 900) - 200 - (365 + (n % 730)),
  (SELECT d FROM _now) + ((n * 37) % 900) - 200 - (365 + (n % 730)),
  (SELECT d FROM _now) + ((n * 37) % 900) - 200,
  CASE
    WHEN n % 25 = 0 THEN 'retired'
    WHEN n % 17 = 0 THEN 'broken'
    WHEN n % 8  = 0 THEN 'spare'
    ELSE 'in_use'
  END,
  CASE WHEN n % 11 = 0
       THEN 'Ghi chú dữ liệu mẫu cho hồ sơ số ' || n || ' — dùng để thử cắt chữ ở cột ghi chú.'
       ELSE NULL END
FROM generate_series(1, 30000) n
JOIN LATERAL (
  SELECT id FROM device_type ORDER BY id OFFSET (n % (SELECT count(*) FROM device_type)) LIMIT 1
) dt ON true
JOIN LATERAL (
  SELECT id, code FROM site WHERE code LIKE 'DMS-%' AND code <> 'DMS-08'
  ORDER BY code OFFSET (n % 7) LIMIT 1
) st ON true
JOIN LATERAL (
  SELECT id FROM cabinet WHERE site_id = st.id ORDER BY code OFFSET (n % 12) LIMIT 1
) cb ON true
JOIN LATERAL (
  SELECT id FROM vendor WHERE name LIKE 'DM %' ORDER BY name OFFSET (n % 12) LIMIT 1
) vd ON true
JOIN LATERAL (
  SELECT name FROM department WHERE name LIKE 'DM %' ORDER BY name OFFSET (n % 15) LIMIT 1
) dp ON true;

-- ------------------------------------------------------------- PHẦN MỀM
-- 2.000 hồ sơ, đủ 5 loại. `perpetual` chỉ hợp lệ khi kind='license' VÀ
-- end_date IS NULL — hai CHECK của bảng, không được vi phạm.
INSERT INTO software (code, name, kind, vendor_id, seat_total, start_date, end_date, note, status, license_model)
SELECT
  'DMSW-' || lpad(n::text, 5, '0'),
  (ARRAY['Bộ Office','Phần mềm kế toán','Chứng chỉ SSL','Tên miền công ty',
         'Hợp đồng bảo trì server','Antivirus tập trung','Phần mềm thiết kế',
         'Giấy phép CAD','Cổng email','Sao lưu đám mây'])[1 + (n % 10)]
    || ' ' || lpad(n::text, 4, '0'),
  k.kind,
  vd.id,
  CASE WHEN k.kind = 'license' THEN 5 + (n % 60) ELSE NULL END,
  -- Lại là `end_date` trước, `start_date` lùi từ nó: CHECK `end_date >= start_date`.
  -- Hồ sơ vĩnh viễn không có `end_date` nên mốc bắt đầu tính thẳng từ hôm nay.
  CASE WHEN k.kind = 'license' AND n % 7 = 0
       THEN (SELECT d FROM _now) - ((n % 800) + 20)
       ELSE (SELECT d FROM _now) + ((n * 53) % 700) - 120 - (180 + (n % 900)) END,
  CASE WHEN k.kind = 'license' AND n % 7 = 0 THEN NULL          -- vĩnh viễn
       ELSE (SELECT d FROM _now) + ((n * 53) % 700) - 120 END,
  NULL,
  CASE WHEN n % 40 = 0 THEN 'retired' ELSE 'active' END,
  CASE WHEN k.kind = 'license' AND n % 7 = 0 THEN 'perpetual' ELSE 'subscription' END
FROM generate_series(1, 2000) n
JOIN LATERAL (
  SELECT (ARRAY['license','license','license','ssl','domain','maintenance','other'])[1 + (n % 7)] AS kind
) k ON true
JOIN LATERAL (
  SELECT id FROM vendor WHERE name LIKE 'DM %' ORDER BY name OFFSET (n % 12) LIMIT 1
) vd ON true;

-- --------------------------------------------------- GÁN GHẾ LICENSE
-- 25.000 lượt gán. Mỗi cặp (software, device) xuất hiện đúng một lần vì
-- device_id lấy theo `n` duy nhất — khớp `license_assignment_active_key`.
INSERT INTO license_assignment (software_id, device_id, assigned_by, assigned_at, cost, contract, start_date, end_date, note)
SELECT
  sw.id,
  dv.id,
  'demo@pmh.com.vn',
  now() - ((n % 400) || ' days')::interval,
  CASE WHEN n % 3 = 0 THEN NULL ELSE (500000 + (n % 40) * 250000)::bigint END,
  CASE WHEN n % 4 = 0 THEN NULL ELSE 'HD-2026-' || lpad((n % 300)::text, 3, '0') END,
  -- Lần thứ ba trong chính tệp này: `end_date` trước, `start_date` lùi từ nó. Ba bảng
  -- (`device`, `software`, `license_assignment`) đều có CHECK `end >= start`, và cả ba lần
  -- tôi đều tính hai mốc độc lập rồi bị CHECK bắt. Quy ước cho lượt gieo sau: **không bao giờ
  -- sinh hai mốc thời gian độc lập nhau cho cùng một hàng.**
  CASE WHEN n % 5 = 0 THEN (SELECT d FROM _now) - ((n % 400) + 10)
       ELSE (SELECT d FROM _now) + ((n * 31) % 600) - 90 - (120 + (n % 500)) END,
  CASE WHEN n % 5 = 0 THEN NULL
       ELSE (SELECT d FROM _now) + ((n * 31) % 600) - 90 END,
  NULL
FROM generate_series(1, 25000) n
JOIN LATERAL (
  SELECT id FROM software WHERE code LIKE 'DMSW-%' AND seat_total IS NOT NULL
  ORDER BY code OFFSET (n % 857) LIMIT 1
) sw ON true
JOIN LATERAL (
  SELECT id FROM device WHERE code = 'DM-' || lpad(n::text, 6, '0')
) dv ON true;

-- --------------------------------------------------------------- DẢI IP
INSERT INTO subnet (name, cidr, site_id, description, created_by, vlan, gateway)
SELECT
  'DM VLAN ' || (100 + n),
  ('10.20.' || n || '.0/24')::cidr,
  st.id,
  'Dải dữ liệu mẫu số ' || n,
  'demo@pmh.com.vn',
  100 + n,
  ('10.20.' || n || '.1')::inet
FROM generate_series(1, 24) n
JOIN LATERAL (
  SELECT id FROM site WHERE code LIKE 'DMS-%' AND code <> 'DMS-08'
  ORDER BY code OFFSET (n % 7) LIMIT 1
) st ON true;

-- 210 hồ sơ IP mỗi dải = 5.040. Trigger `ip_address_within_subnet` kiểm
-- từng dòng nằm trong dải của nó — địa chỉ dưới đây luôn thoả.
INSERT INTO ip_address (subnet_id, address, device_id, used_by, assigned_by, assigned_at, status, note)
SELECT
  sn.id,
  ('10.20.' || sn.n || '.' || (9 + h))::inet,
  CASE WHEN h % 4 = 0 OR h % 53 = 0 THEN NULL ELSE dv.id END,
  CASE WHEN h % 4 = 0 OR h % 53 = 0 THEN NULL ELSE 'DM ' || (ARRAY['Kế toán','Kỹ thuật','Kho vận','Sản xuất'])[1 + (h % 4)] END,
  'demo@pmh.com.vn',
  (SELECT d FROM _now) - ((h * 3) % 600),
  CASE WHEN h % 4 = 0 OR h % 53 = 0 THEN 'free' ELSE 'assigned' END,
  NULL
FROM (
  SELECT id, (split_part(host(cidr), '.', 3))::int AS n
  FROM subnet WHERE name LIKE 'DM VLAN %'
) sn
CROSS JOIN generate_series(1, 210) h
JOIN LATERAL (
  SELECT id FROM device
  WHERE code = 'DM-' || lpad((((sn.n - 1) * 210 + h) % 30000 + 1)::text, 6, '0')
) dv ON true;

-- --------------------------------------------------------------- SỔ NAT
-- Một rule mỗi thiết bị ⇒ EXCLUDE (device_id, protocol, dải cổng) không
-- bao giờ chạm nhau. 800 rule.
INSERT INTO nat_rule (device_id, protocol, external_from, external_to, internal_ip, internal_port, used_by, reason, enabled, created_by)
SELECT
  dv.id,
  (ARRAY['tcp','udp','both'])[1 + (n % 3)],
  20000 + n,
  20000 + n,
  ('10.20.' || (1 + (n % 24)) || '.' || (10 + (n % 200)))::inet,
  (ARRAY[80, 443, 3389, 22, 8080, 1433, 5432])[1 + (n % 7)],
  'DM ' || (ARRAY['Kỹ thuật','Kế toán','Sản xuất'])[1 + (n % 3)],
  'Mở cổng cho dữ liệu mẫu số ' || n,
  n % 9 <> 0,
  'demo@pmh.com.vn'
FROM generate_series(1, 800) n
JOIN LATERAL (
  SELECT id FROM device WHERE code = 'DM-' || lpad((n * 7)::text, 6, '0')
) dv ON true;

-- ------------------------------------------------- TÀI KHOẢN DỊCH VỤ
INSERT INTO service_account (code, kind, name, login, department, owner_name, group_name, allowed_ips, note, status, created_by)
SELECT
  'DMSA-' || lpad(n::text, 4, '0'),
  CASE WHEN n % 3 = 0 THEN 'vpn' ELSE 'shared' END,
  (ARRAY['Email dùng chung','Cổng nhà mạng','Tài khoản VPN','Tài khoản FTP',
         'Tài khoản camera','Tài khoản NAS'])[1 + (n % 6)] || ' ' || lpad(n::text, 4, '0'),
  'svc' || lpad(n::text, 4, '0') || '@pmh.com.vn',
  dp.name,
  (ARRAY['Nguyễn Văn An','Trần Thị Bình','Lê Hoàng Cường'])[1 + (n % 3)],
  CASE WHEN n % 3 = 0 THEN 'grp-vpn-' || (1 + (n % 5)) ELSE NULL END,
  CASE WHEN n % 3 = 0 THEN '10.20.' || (1 + (n % 24)) || '.0/24' ELSE NULL END,
  NULL,
  CASE WHEN n % 20 = 0 THEN 'disabled' ELSE 'active' END,
  'demo@pmh.com.vn'
FROM generate_series(1, 600) n
JOIN LATERAL (
  SELECT name FROM department WHERE name LIKE 'DM %' ORDER BY name OFFSET (n % 15) LIMIT 1
) dp ON true;

COMMIT;

ANALYZE device;
ANALYZE software;
ANALYZE license_assignment;
ANALYZE ip_address;
ANALYZE nat_rule;
ANALYZE service_account;

SELECT 'device' AS bang, count(*) FROM device WHERE code LIKE 'DM-%'
UNION ALL SELECT 'software', count(*) FROM software WHERE code LIKE 'DMSW-%'
UNION ALL SELECT 'license_assignment', count(*) FROM license_assignment WHERE assigned_by = 'demo@pmh.com.vn'
UNION ALL SELECT 'subnet', count(*) FROM subnet WHERE name LIKE 'DM VLAN %'
UNION ALL SELECT 'ip_address', count(*) FROM ip_address WHERE assigned_by = 'demo@pmh.com.vn'
UNION ALL SELECT 'nat_rule', count(*) FROM nat_rule WHERE created_by = 'demo@pmh.com.vn'
UNION ALL SELECT 'service_account', count(*) FROM service_account WHERE code LIKE 'DMSA-%'
UNION ALL SELECT 'cabinet', count(*) FROM cabinet WHERE code LIKE 'T-%' AND site_id IN (SELECT id FROM site WHERE code LIKE 'DMS-%')
UNION ALL SELECT 'site', count(*) FROM site WHERE code LIKE 'DMS-%'
UNION ALL SELECT 'vendor', count(*) FROM vendor WHERE name LIKE 'DM %'
UNION ALL SELECT 'department', count(*) FROM department WHERE name LIKE 'DM %';

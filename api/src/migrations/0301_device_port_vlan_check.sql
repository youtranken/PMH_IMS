-- OLD-DB-04 · VLAN của cổng chỉ nhận số 1–4094 hoặc "trunk" (Q-16).
--
-- Cột giữ kiểu text: "trunk" là giá trị hay gặp nhất trên cổng uplink (0029), ép sang integer
-- là ép bỏ trống ô đó. Nhưng text không ràng buộc thì "VLAN20", "vlan 20", "v20" cùng nằm
-- trong bảng và lọc theo VLAN không làm được — đúng lý do `subnet.vlan` là integer. CHECK dưới
-- đây giữ cả hai: số thì đúng dải 802.1Q như `subnet_vlan_check`, chữ thì chỉ một từ.
--
-- Khoảng trắng thừa và hoa-thường ("Trunk", " 20 ") có nghĩa rõ ràng nên được chuẩn hoá luôn.
-- Mọi phép so dưới đây dùng CASE chứ không AND: SQL không hứa thứ tự tính của AND, và
-- `'trunk'::int` ném lỗi.

/*
 * Thứ không đoán được nghĩa thì dừng và kể tên từng cổng, với giá trị GỐC người trực nhìn
 * thấy trên màn hình. Việc phải làm là sửa VLAN của các cổng đó trên port map rồi chạy lại.
 */
DO $$
DECLARE
  bad_report text;
BEGIN
  SELECT string_agg(format('%s cổng %s: "%s"', d.code, p.port_label, p.vlan), E'\n'
                    ORDER BY d.code, p.port_label)
    INTO bad_report
    FROM device_port p
    JOIN device d ON d.id = p.device_id
   CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(p.vlan)), '') AS v) n
   WHERE n.v IS NOT NULL
     AND NOT CASE
           WHEN n.v ~ '^[1-9][0-9]{0,3}$' THEN n.v::int <= 4094
           ELSE n.v = 'trunk'
         END;

  IF bad_report IS NOT NULL THEN
    RAISE EXCEPTION E'VLAN của các cổng sau không phải số 1–4094 hay "trunk":\n%\n\nSửa trên port map của thiết bị rồi chạy lại migration.', bad_report;
  END IF;
END $$;

UPDATE device_port SET vlan = NULLIF(lower(btrim(vlan)), '')
 WHERE vlan IS DISTINCT FROM NULLIF(lower(btrim(vlan)), '');

ALTER TABLE device_port ADD CONSTRAINT device_port_vlan_check CHECK (
  vlan IS NULL OR CASE
    WHEN vlan ~ '^[1-9][0-9]{0,3}$' THEN vlan::int <= 4094
    ELSE vlan = 'trunk'
  END
);

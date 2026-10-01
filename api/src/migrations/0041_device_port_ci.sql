-- Sơ đồ cổng (Q-20): tên cổng không phân biệt hoa/thường — "Gi1/0/1" và "gi1/0/1" là MỘT lỗ cắm.
-- Hai khoá duy nhất cũ so nguyên chữ nên lọt hai dòng cho cùng một cổng; thay bằng chỉ mục trên
-- lower(...), GIỮ NGUYÊN TÊN để mã dịch lỗi (`conflictOnUnique`) không phải đổi.
--
-- Luật "một cổng một sợi cáp kiểm cả hai chiều" (đầu GHI của dòng này trùng đầu KIA của dòng
-- khác) không viết được bằng chỉ mục duy nhất — nó so hai cặp cột khác nhau giữa hai hàng.
-- Phần đó nằm ở `DevicePortsService` dưới khoá advisory theo từng cổng.
--
-- Dữ liệu đã có mà vi phạm thì DỪNG kèm câu nói rõ, không tự gộp: chọn giữ dòng nào là việc của
-- người biết sợi cáp thật nằm đâu.
DO $$
DECLARE
  clash text;
BEGIN
  SELECT format('thiết bị %s có cổng "%s" khai nhiều dòng (khác hoa/thường)', d.code, min(p.port_label))
    INTO clash
    FROM device_port p JOIN device d ON d.id = p.device_id
   GROUP BY d.code, p.device_id, lower(p.port_label)
  HAVING count(*) > 1
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Không áp được 0041: %. Gộp/xoá dòng thừa trong port map rồi chạy lại.', clash;
  END IF;

  SELECT format('cổng "%s" của thiết bị %s có nhiều dòng nối vào (khác hoa/thường)', min(p.connected_port), d.code)
    INTO clash
    FROM device_port p JOIN device d ON d.id = p.connected_device_id
   WHERE p.connected_device_id IS NOT NULL AND p.connected_port IS NOT NULL AND NOT p.owner_retired
   GROUP BY d.code, p.connected_device_id, lower(p.connected_port)
  HAVING count(*) > 1
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Không áp được 0041: %. Gộp/xoá dòng thừa trong port map rồi chạy lại.', clash;
  END IF;
END $$;

ALTER TABLE device_port DROP CONSTRAINT device_port_label_key;
CREATE UNIQUE INDEX device_port_label_key ON device_port USING btree (device_id, lower(port_label));

DROP INDEX device_port_peer_port_key;
CREATE UNIQUE INDEX device_port_peer_port_key ON device_port USING btree (connected_device_id, lower(connected_port)) WHERE ((connected_device_id IS NOT NULL) AND (connected_port IS NOT NULL) AND (NOT owner_retired));

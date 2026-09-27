-- OLD-DB-02 (AD-14): một sợi dây = một bản ghi. `device_port_label_key` chỉ giữ được đầu GHI
-- (một thiết bị không có hai dòng cho cùng cổng); đầu KIA thì chưa ai giữ, nên hai máy khác
-- nhau cùng ghi "đấu vào SW-01 cổng Gi1/0/24" được — hai sợi dây cho một lỗ cắm.
--
-- Chỉ tính dòng của máy CHƯA thanh lý. Sơ đồ đấu nối của máy đã thanh lý được giữ làm bằng
-- chứng và bị khoá không sửa được (`DevicePortsService.remove`); nếu nó vẫn chiếm lỗ cắm thì
-- máy thay thế không bao giờ khai được vào đúng cổng đó, và cũng không ai gỡ được dòng cũ.
-- Chỉ mục riêng phần không tham chiếu được bảng `device`, nên trạng thái đó phải nằm ngay trên
-- `device_port` (`owner_retired`), do trigger giữ khớp với `device.status`.
--
-- Chỉ mục dựng trong transaction, không CONCURRENTLY: bước kiểm trùng và bước dựng khoá phải
-- nằm trong cùng một transaction, nếu không một dòng trùng chen vào giữa sẽ để lại chỉ mục
-- INVALID. `device_port` chỉ vài trăm dòng nên khoá SHARE lúc dựng là không đáng kể.

-- Dừng trước với câu lỗi nói rõ dòng nào trùng dòng nào, thay vì để CREATE INDEX ném 23505 trần.
DO $$
DECLARE
  clash_report text;
BEGIN
  SELECT string_agg(format('%s cổng %s ← %s', peer.code, grp.connected_port, grp.holders), E'\n')
    INTO clash_report
    FROM (
      SELECT p.connected_device_id, p.connected_port,
             string_agg(format('%s/%s (id %s)', d.code, p.port_label, p.id), ', '
                        ORDER BY d.code, p.port_label) AS holders
        FROM device_port p
        JOIN device d ON d.id = p.device_id
       WHERE d.status <> 'retired'
         AND p.connected_device_id IS NOT NULL
         AND p.connected_port IS NOT NULL
       GROUP BY p.connected_device_id, p.connected_port
      HAVING count(*) > 1
    ) grp
    JOIN device peer ON peer.id = grp.connected_device_id;

  IF clash_report IS NOT NULL THEN
    RAISE EXCEPTION E'Có cổng đầu kia đang bị nhiều dòng port map cùng ghi đấu vào:\n%\n\nGiữ một dòng cho mỗi cổng (sửa hoặc gỡ các dòng còn lại ở tab Port map của thiết bị giữ dòng đó) rồi chạy lại migration.', clash_report;
  END IF;
END $$;

ALTER TABLE device_port
  ADD COLUMN owner_retired boolean NOT NULL DEFAULT false;

UPDATE device_port p
   SET owner_retired = true
  FROM device d
 WHERE d.id = p.device_id AND d.status = 'retired';

CREATE FUNCTION device_port_owner_retired_sync() RETURNS trigger AS $$
BEGIN
  UPDATE device_port
     SET owner_retired = (NEW.status = 'retired')
   WHERE device_id = NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Mở lại một máy đã thanh lý cũng đi qua đây: nếu cổng đầu kia đã có máy khác chiếm thì chính
-- câu UPDATE này ném 23505, và lượt mở lại rollback cùng nó.
CREATE TRIGGER device_port_owner_retired_sync
  AFTER UPDATE OF status ON device
  FOR EACH ROW
  WHEN ((OLD.status = 'retired') IS DISTINCT FROM (NEW.status = 'retired'))
  EXECUTE FUNCTION device_port_owner_retired_sync();

-- Dòng mới lấy trạng thái từ máy chủ của nó, không tin giá trị client gửi lên.
CREATE FUNCTION device_port_owner_retired_init() RETURNS trigger AS $$
BEGIN
  SELECT d.status = 'retired' INTO NEW.owner_retired FROM device d WHERE d.id = NEW.device_id;
  NEW.owner_retired := coalesce(NEW.owner_retired, false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_port_owner_retired_init
  BEFORE INSERT OR UPDATE OF device_id, owner_retired ON device_port
  FOR EACH ROW EXECUTE FUNCTION device_port_owner_retired_init();

CREATE UNIQUE INDEX device_port_peer_port_key
  ON device_port (connected_device_id, connected_port)
  WHERE connected_device_id IS NOT NULL
    AND connected_port IS NOT NULL
    AND NOT owner_retired;

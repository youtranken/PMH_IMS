-- device_port — chủ: devices. Port map (FR-006, AD-14). MỘT sợi dây = MỘT bản ghi, ghi ở một
-- phía; phía kia hiện bằng query theo `connected_device_id`, không có bản ghi đối xứng.
-- `device_port_peer_port_key` giữ đầu KIA: hai máy không cùng cắm vào một lỗ. Chỉ tính máy chưa
-- thanh lý — port map của máy đã thanh lý giữ làm bằng chứng, và không được chặn máy thay thế.
-- VLAN: số 1–4094 hoặc "trunk" (Q-16). CASE chứ không AND vì SQL không hứa thứ tự tính của AND,
-- và `'trunk'::int` ném lỗi.
CREATE TABLE device_port (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    port_label text NOT NULL,
    connected_device_id uuid,
    connected_label text,
    connected_port text,
    used_by text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vlan text,
    owner_retired boolean DEFAULT false NOT NULL,
    CONSTRAINT device_port_not_self_check CHECK (((connected_device_id IS NULL) OR (connected_device_id <> device_id))),
    CONSTRAINT device_port_vlan_check CHECK (((vlan IS NULL) OR
CASE
    WHEN (vlan ~ '^[1-9][0-9]{0,3}$'::text) THEN ((vlan)::integer <= 4094)
    ELSE (vlan = 'trunk'::text)
END)),
    CONSTRAINT device_port_label_key UNIQUE (device_id, port_label),
    CONSTRAINT device_port_pkey PRIMARY KEY (id),
    CONSTRAINT device_port_connected_device_id_fkey FOREIGN KEY (connected_device_id) REFERENCES device(id) ON DELETE RESTRICT,
    CONSTRAINT device_port_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT
);
CREATE INDEX device_port_connected_idx ON device_port USING btree (connected_device_id) WHERE (connected_device_id IS NOT NULL);
CREATE UNIQUE INDEX device_port_peer_port_key ON device_port USING btree (connected_device_id, connected_port) WHERE ((connected_device_id IS NOT NULL) AND (connected_port IS NOT NULL) AND (NOT owner_retired));

-- `device_port.owner_retired` là bản sao của "thiết bị đã thanh lý" để chỉ mục riêng phần
-- device_port_peer_port_key dùng được (chỉ mục riêng phần không tham chiếu bảng khác được).
-- Hai trigger dưới đây giữ nó khớp với `device.status`.
CREATE FUNCTION device_port_owner_retired_init() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  SELECT d.status = 'retired' INTO NEW.owner_retired FROM device d WHERE d.id = NEW.device_id;
  NEW.owner_retired := coalesce(NEW.owner_retired, false);
  RETURN NEW;
END;
$$;

CREATE FUNCTION device_port_owner_retired_sync() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE device_port
     SET owner_retired = (NEW.status = 'retired')
   WHERE device_id = NEW.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER device_port_owner_retired_init BEFORE INSERT OR UPDATE OF device_id, owner_retired ON device_port FOR EACH ROW EXECUTE FUNCTION device_port_owner_retired_init();
CREATE TRIGGER device_port_owner_retired_sync AFTER UPDATE OF status ON device FOR EACH ROW WHEN (((old.status = 'retired'::text) IS DISTINCT FROM (new.status = 'retired'::text))) EXECUTE FUNCTION device_port_owner_retired_sync();

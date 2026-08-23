-- Story 5.1/5.2 (FR-018, FR-019, FR-020, AD-3, AD-13): subnet, hồ sơ IP, lịch sử IP.
-- Chủ sở hữu: module `ipam` — module khác đọc qua `IpamApiService`, không query thẳng.
--
-- Kiểu dữ liệu là `cidr`/`inet` của Postgres chứ không phải `text`: có sẵn phép `<<=`
-- ("nằm trong dải"), sắp xếp đúng thứ tự số học (text thì .10 đứng trước .9), và không
-- nhận vào được chuỗi rác. Đây là chỗ đáng để DB làm hộ.

CREATE TABLE subnet (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  cidr         cidr NOT NULL,
  site_id      uuid REFERENCES site (id) ON DELETE RESTRICT,
  description  text,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Quyết định của anh Thuận (2026-08-23): KHÔNG xóa hẳn. Bản ghi nhập nhầm được đánh dấu
  -- và ẩn khỏi mọi danh sách, vẫn tra cứu được, vẫn còn vết ai nhập ai ẩn.
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text,
  CONSTRAINT subnet_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  ),
  -- v1 chỉ IPv4 (LAN 172.16.x/24). Nhận IPv6 nửa vời tệ hơn từ chối thẳng.
  CONSTRAINT subnet_ipv4_check CHECK (family(cidr) = 4)
);

-- Ẩn rồi thì KHÔNG chặn khai lại dải đó nữa: nhập nhầm một lần mà khóa vĩnh viễn cả dải
-- thì người ta sẽ đi sửa thẳng vào DB, và đó mới là thứ đáng sợ.
CREATE UNIQUE INDEX subnet_cidr_key ON subnet (cidr) WHERE voided_at IS NULL;
CREATE INDEX subnet_site_idx ON subnet (site_id) WHERE voided_at IS NULL;

CREATE TABLE ip_address (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subnet_id    uuid NOT NULL REFERENCES subnet (id) ON DELETE RESTRICT,
  address      inet NOT NULL,
  -- Thiết bị giữ IP. FK thật: `devices` và `ipam` cùng một database, và "IP trỏ tới thiết bị
  -- đã bị xóa" là loại rác không đáng cho phép tồn tại. RESTRICT chứ không CASCADE — xóa
  -- thiết bị đang giữ IP phải là một hành động có ý thức.
  device_id    uuid REFERENCES device (id) ON DELETE RESTRICT,
  used_by      text,
  assigned_by  text NOT NULL,
  assigned_at  date,
  status       text NOT NULL DEFAULT 'assigned',
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text,
  CONSTRAINT ip_address_status_check
    CHECK (status IN ('free', 'assigned', 'suspect_dead', 'reclaimed')),
  CONSTRAINT ip_address_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  ),
  CONSTRAINT ip_address_ipv4_check CHECK (family(address) = 4)
);

-- AC 5.1: "IP trùng trong cùng subnet bị CHẶN tuyệt đối (unique constraint tầng DB)".
-- Ở tầng DB nên không có đường vòng: dù service quên kiểm, dù hai request vào cùng lúc,
-- dù ai đó chạy INSERT tay — vẫn chặn.
CREATE UNIQUE INDEX ip_address_key ON ip_address (subnet_id, address) WHERE voided_at IS NULL;
CREATE INDEX ip_address_subnet_idx ON ip_address (subnet_id, address) WHERE voided_at IS NULL;
CREATE INDEX ip_address_device_idx ON ip_address (device_id) WHERE voided_at IS NULL;
CREATE INDEX ip_address_status_idx ON ip_address (status) WHERE voided_at IS NULL;

/*
 * AC 5.1: "IP ngoài dải subnet bị từ chối".
 *
 * Ở DB chứ không chỉ ở service: `CHECK` không tra được bảng khác nên phải là trigger.
 * Đáng công vì đây là ràng buộc mà sai thì hỏng ngoài đời thật — một IP khai nhầm subnet
 * trông vẫn hợp lệ trên màn hình, chỉ khi máy không ra được mạng mới biết.
 */
CREATE FUNCTION ip_address_within_subnet() RETURNS trigger AS $$
DECLARE
  parent cidr;
BEGIN
  SELECT cidr INTO parent FROM subnet WHERE id = NEW.subnet_id;
  IF parent IS NULL THEN
    RAISE EXCEPTION 'Subnet % không tồn tại', NEW.subnet_id;
  END IF;
  IF NOT (NEW.address <<= parent) THEN
    RAISE EXCEPTION 'Địa chỉ % không nằm trong dải %', NEW.address, parent
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ip_address_within_subnet_ins BEFORE INSERT ON ip_address
  FOR EACH ROW EXECUTE FUNCTION ip_address_within_subnet();
CREATE TRIGGER ip_address_within_subnet_upd BEFORE UPDATE OF address, subnet_id ON ip_address
  FOR EACH ROW EXECUTE FUNCTION ip_address_within_subnet();

-- AD-13: lịch sử vòng đời IP, APPEND-ONLY. AC 5.2 đòi lịch sử giữ VĨNH VIỄN — "IP này từng
-- là máy in kế toán" phải trả lời được nhiều năm sau, kể cả khi IP đã cấp lại cho máy khác.
CREATE TABLE ip_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address_id uuid NOT NULL REFERENCES ip_address (id) ON DELETE RESTRICT,
  action        text NOT NULL,
  actor         text NOT NULL,
  from_status   text,
  to_status     text,
  changes       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ip_history_ip_idx ON ip_history (ip_address_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ip_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER ip_history_no_update BEFORE UPDATE ON ip_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER ip_history_no_delete BEFORE DELETE ON ip_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Story 2.2 (FR-001, FR-007): hồ sơ thiết bị. Chủ sở hữu: module `devices` (AD-3).
--
-- KHÔNG có cột deleted_at và KHÔNG có endpoint xóa: thiết bị chỉ chuyển trạng thái
-- (đang dùng → dự phòng → hỏng → đã thanh lý). Sổ tài sản mà xóa được thì kiểm kê
-- năm sau không đối chiếu nổi.
CREATE TABLE device (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mã người dùng gõ khi tra cứu VÀ là khóa để import lại (import trùng mã = cập nhật).
  code            citext NOT NULL UNIQUE,
  name            text NOT NULL,
  device_type_id  uuid NOT NULL REFERENCES device_type (id) ON DELETE RESTRICT,
  model           text,
  serial          text,
  site_id         uuid REFERENCES site (id) ON DELETE RESTRICT,
  -- Thiết bị không nằm trong tủ (PC, máy in, AP treo tường) để trống cabinet_id.
  cabinet_id      uuid REFERENCES cabinet (id) ON DELETE RESTRICT,
  vendor_id       uuid REFERENCES vendor (id) ON DELETE RESTRICT,
  assigned_to     text,
  department      text,
  purchase_date   date,
  warranty_start  date,
  warranty_end    date,
  status          text NOT NULL DEFAULT 'in_use',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_status_check
    CHECK (status IN ('in_use', 'spare', 'broken', 'retired')),
  -- Bảo hành phải là một khoảng thời gian có nghĩa; nhập ngược ngày là lỗi gõ.
  CONSTRAINT device_warranty_range_check
    CHECK (warranty_start IS NULL OR warranty_end IS NULL OR warranty_end >= warranty_start)
);

-- Lọc theo site/tủ/loại/trạng thái là thao tác hàng ngày trên 300+ dòng (AC "< 2 giây").
CREATE INDEX device_site_idx     ON device (site_id);
CREATE INDEX device_cabinet_idx  ON device (cabinet_id);
CREATE INDEX device_type_idx     ON device (device_type_id);
CREATE INDEX device_status_idx   ON device (status);
-- Cảnh báo bảo hành (Epic 3) quét theo hạn; chỉ thiết bị còn dùng mới cần nhắc.
CREATE INDEX device_warranty_idx ON device (warranty_end) WHERE status <> 'retired';
-- Serial KHÔNG unique: thực tế có thiết bị chưa biết serial, có bộ nhập trùng do dán nhầm
-- tem. Trùng serial chỉ CẢNH BÁO lúc lưu (AC 2.2), không chặn — nhưng phải tra nhanh được.
CREATE INDEX device_serial_idx   ON device (lower(serial)) WHERE serial IS NOT NULL;

-- AD-13: lịch sử hồ sơ thiết bị, APPEND-ONLY (dùng lại hàm history_append_only của 0010).
-- FR-007: tab Lịch sử trên trang chi tiết đọc thẳng bảng này.
CREATE TABLE device_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  action     text NOT NULL,
  actor      text NOT NULL,
  changes    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_history_device_idx ON device_history (device_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON device_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER device_history_no_update BEFORE UPDATE ON device_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER device_history_no_delete BEFORE DELETE ON device_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

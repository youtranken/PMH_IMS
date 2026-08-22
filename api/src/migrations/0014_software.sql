-- Story 3.1 (FR-008/FR-009): hồ sơ phần mềm có ngày gia hạn.
-- Chủ sở hữu: module `software` (AD-3).
--
-- KHÔNG có cột key / valid-key ở đây (AC 3.1): chìa khóa và mật khẩu nằm trong két sắt
-- (Epic 4), bảng này chỉ giữ hồ sơ hành chính. Đặt key vào đây là mở một đường rò rỉ
-- thứ hai ngoài vault, đúng thứ AD-4 sinh ra để chặn.
CREATE TABLE software (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mã người dùng gõ khi tra cứu VÀ là khóa để import lại (giống thiết bị).
  code         citext NOT NULL UNIQUE,
  name         text NOT NULL,
  kind         text NOT NULL,
  vendor_id    uuid REFERENCES vendor (id) ON DELETE RESTRICT,
  -- Số máy được phép cài (chỉ có nghĩa với license). NULL = không giới hạn/không áp dụng.
  seat_total   integer,
  start_date   date,
  end_date     date,
  note         text,
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT software_kind_check
    CHECK (kind IN ('license', 'ssl', 'domain', 'maintenance', 'other')),
  CONSTRAINT software_status_check
    CHECK (status IN ('active', 'expired_ok', 'retired')),
  CONSTRAINT software_range_check
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT software_seat_check
    CHECK (seat_total IS NULL OR seat_total > 0)
);

CREATE INDEX software_kind_idx ON software (kind);
CREATE INDEX software_vendor_idx ON software (vendor_id);
-- Cỗ máy expiry (story 3.4) quét theo hạn; thứ đã thanh lý thì thôi không nhắc nữa.
CREATE INDEX software_end_idx ON software (end_date) WHERE status <> 'retired';

-- AD-13: lịch sử hồ sơ phần mềm, append-only (dùng lại hàm history_append_only của 0010).
CREATE TABLE software_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  software_id uuid NOT NULL REFERENCES software (id) ON DELETE RESTRICT,
  action      text NOT NULL,
  actor       text NOT NULL,
  changes     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX software_history_idx ON software_history (software_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON software_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER software_history_no_update BEFORE UPDATE ON software_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER software_history_no_delete BEFORE DELETE ON software_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

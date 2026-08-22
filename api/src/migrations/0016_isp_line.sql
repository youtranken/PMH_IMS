-- Story 3.3 (FR-010): hồ sơ đường truyền ISP.
-- Chủ sở hữu: module `software` (AD-3) — cùng nhà với license/SSL vì đều là "hợp đồng có
-- ngày gia hạn", và spine chỉ khai đúng 8 module nghiệp vụ, không có module `isp` riêng.
--
-- Đây LÀ hợp đồng ISP luôn (có số hợp đồng + start/end), không phải bản sao của một dòng
-- trong bảng `software` — xem docs/CAN-XAC-NHAN.md mục 1.
CREATE TABLE isp_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mã nội bộ để gọi tên đường truyền khi trực sự cố: "đứt FPT-HO-01".
  code          citext NOT NULL UNIQUE,
  provider      text NOT NULL,
  bandwidth     text,
  -- IP WAN tĩnh nhà mạng cấp. Kiểu text vì có đường được cấp cả dải, có đường ghi "động".
  wan_ip        text,
  site_id       uuid REFERENCES site (id) ON DELETE RESTRICT,
  -- Thiết bị biên đang cắm đường này (thường là Draytek). Trang thiết bị đó sẽ hiện ngược lại.
  device_id     uuid REFERENCES device (id) ON DELETE RESTRICT,
  -- Hai thứ cần nhất lúc 2 giờ sáng: gọi ai và đọc số hợp đồng nào.
  hotline       text,
  contract_no   text,
  start_date    date,
  end_date      date,
  note          text,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT isp_line_status_check
    CHECK (status IN ('active', 'suspended', 'terminated')),
  CONSTRAINT isp_line_range_check
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX isp_line_site_idx ON isp_line (site_id);
CREATE INDEX isp_line_device_idx ON isp_line (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX isp_line_provider_idx ON isp_line (provider);
-- Cỗ máy expiry (3.4) quét theo hạn; đường đã cắt thì thôi không nhắc.
CREATE INDEX isp_line_end_idx ON isp_line (end_date) WHERE status <> 'terminated';

-- AD-13: lịch sử hồ sơ ISP, append-only (dùng lại hàm history_append_only của 0010).
CREATE TABLE isp_line_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isp_line_id  uuid NOT NULL REFERENCES isp_line (id) ON DELETE RESTRICT,
  action       text NOT NULL,
  actor        text NOT NULL,
  changes      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX isp_line_history_idx ON isp_line_history (isp_line_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON isp_line_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER isp_line_history_no_update BEFORE UPDATE ON isp_line_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER isp_line_history_no_delete BEFORE DELETE ON isp_line_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Story 6.1 (FR-023, FR-033, AD-6): MỘT bảng duyệt cho MỌI luồng xin–duyệt.
-- Chủ sở hữu: module `approvals` (tầng nền).
--
-- Từ vựng state KHÔNG nằm trong CHECK constraint: mỗi loại yêu cầu tự mang máy trạng thái
-- của mình (`ApprovalFlowSpec`) và `approvals` chỉ biết cách chạy một máy bất kỳ. Break-glass
-- và phiếu ISO (Epic 8) có từ vựng khác hẳn nhau — nhét cả hai vào một CHECK cứng là bắt đầu
-- con đường quen thuộc: một cột `status` với mười giá trị mà nửa số đó chỉ dùng cho một loại,
-- và mỗi loại mới lại là một migration sửa CHECK.
--
-- Đổi lại, tầng DB không bảo vệ được từ vựng — nên `ApprovalService.transition()` là đường
-- DUY NHẤT đổi `state`, và nó tra sổ đăng ký trước khi ghi.

CREATE TABLE approval (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  state         text NOT NULL,
  -- Ai xin. Lưu email chứ không FK sang `users`: nhật ký duyệt phải đọc được cả khi tài
  -- khoản đã bị xóa — đúng nếp của `audit_log.actor`.
  requester     text NOT NULL,
  -- Đối tượng xin quyền, tham chiếu LỎNG: `approvals` là tầng nền, không được biết bảng của
  -- module nghiệp vụ nào (AD-2).
  subject_type  text NOT NULL,
  subject_id    uuid NOT NULL,
  reason        text NOT NULL,
  -- Chỗ cho từng loại nhét thêm dữ liệu của riêng nó (vd break-glass: số giờ xin).
  payload       jsonb,
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  /*
   * AD-6: "grant break-glass mang `expires_at`; hiệu lực kiểm tại MỖI lần đọc bằng
   * `expires_at > now()` — không tin status".
   *
   * Cột này là NGUỒN SỰ THẬT về hiệu lực. `state = 'approved'` chỉ nói "đã có người duyệt",
   * KHÔNG nói "còn dùng được". Sweep đổi state sang `expired` chỉ để danh sách đọc gọn.
   */
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_decided_check CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);

CREATE INDEX approval_kind_state_idx ON approval (kind, state, created_at DESC);
CREATE INDEX approval_requester_idx ON approval (requester, created_at DESC);
CREATE INDEX approval_subject_idx ON approval (kind, subject_type, subject_id);
-- Sweep tìm grant tới hạn: chỉ quét những cái CÓ hạn và chưa đóng.
CREATE INDEX approval_expiry_idx ON approval (expires_at) WHERE expires_at IS NOT NULL;

-- AD-13: lịch sử duyệt APPEND-ONLY. Đây là thứ FR-025 đem lên dashboard và là thứ auditor
-- đọc: ai xin, lý do gì, ai duyệt, lúc nào.
CREATE TABLE approval_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES approval (id) ON DELETE RESTRICT,
  action      text NOT NULL,
  actor       text NOT NULL,
  from_state  text,
  to_state    text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_history_idx ON approval_history (approval_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON approval_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER approval_history_no_update BEFORE UPDATE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER approval_history_no_delete BEFORE DELETE ON approval_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- AD-11: ngưỡng nhắc yêu cầu treo lâu. 0 = tắt nhắc.
INSERT INTO system_config (key, value, description)
VALUES (
  'approval.reminder_hours',
  '4',
  'Yêu cầu duyệt treo quá bao nhiêu giờ thì nhắc người duyệt. 0 = tắt nhắc.'
)
ON CONFLICT (key) DO NOTHING;

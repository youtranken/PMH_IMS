-- approval — chủ: approvals (tầng nền, FR-023, FR-033, AD-6). Một bảng cho mọi luồng xin–duyệt;
-- từ vựng state thuộc từng loại yêu cầu nên không nằm trong CHECK. `approval_one_pending_key`:
-- mỗi chủ thể một yêu cầu đang treo — hai cú bấm cùng lúc không sinh hai yêu cầu.
CREATE TABLE approval (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    requester text NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    reason text NOT NULL,
    payload jsonb,
    decided_by text,
    decided_at timestamp with time zone,
    decision_note text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requester_session_id uuid,
    claimed_session_id uuid,
    claimed_at timestamp with time zone,
    CONSTRAINT approval_decided_check CHECK (((decided_at IS NULL) = (decided_by IS NULL))),
    CONSTRAINT approval_pkey PRIMARY KEY (id)
);
CREATE INDEX approval_expiry_idx ON approval USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX approval_kind_state_idx ON approval USING btree (kind, state, created_at DESC);
CREATE INDEX approval_requester_idx ON approval USING btree (requester, created_at DESC);
CREATE INDEX approval_subject_idx ON approval USING btree (kind, subject_type, subject_id);
CREATE UNIQUE INDEX approval_one_pending_key ON approval USING btree (kind, requester, subject_type, subject_id) WHERE (state = 'pending'::text);

-- approval_history — lịch sử từng yêu cầu duyệt.
CREATE TABLE approval_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approval_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    from_state text,
    to_state text,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approval_history_pkey PRIMARY KEY (id),
    CONSTRAINT approval_history_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES approval(id) ON DELETE RESTRICT
);
CREATE INDEX approval_history_idx ON approval_history USING btree (approval_id, created_at DESC);
CREATE TRIGGER approval_history_no_delete BEFORE DELETE ON approval_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER approval_history_no_truncate BEFORE TRUNCATE ON approval_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER approval_history_no_update BEFORE UPDATE ON approval_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON approval_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON approval_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'approval_history', 'UPDATE') THEN
    GRANT UPDATE ON approval_history TO CURRENT_USER;
  END IF;
END $$;

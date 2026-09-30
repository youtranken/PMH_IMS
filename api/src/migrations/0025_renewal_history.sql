-- renewal_history — chủ: expiry (tầng nền). Lịch sử gia hạn của mọi loại hồ sơ trong một bảng,
-- để "năm ngoái gia hạn những gì" là một câu query.
CREATE TABLE renewal_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    object_kind text NOT NULL,
    object_id uuid NOT NULL,
    label text NOT NULL,
    old_end date,
    new_end date NOT NULL,
    actor text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    contract text,
    cost bigint,
    websites text[],
    CONSTRAINT renewal_history_cost_check CHECK (((cost IS NULL) OR (cost >= 0))),
    CONSTRAINT renewal_history_pkey PRIMARY KEY (id)
);
CREATE INDEX renewal_history_created_idx ON renewal_history USING btree (created_at DESC);
CREATE INDEX renewal_history_object_idx ON renewal_history USING btree (object_kind, object_id, created_at DESC);
CREATE TRIGGER renewal_history_no_delete BEFORE DELETE ON renewal_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER renewal_history_no_truncate BEFORE TRUNCATE ON renewal_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER renewal_history_no_update BEFORE UPDATE ON renewal_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
REVOKE UPDATE, DELETE, TRUNCATE ON renewal_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON renewal_history FROM CURRENT_USER;

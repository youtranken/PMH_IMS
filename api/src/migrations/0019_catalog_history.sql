-- catalog_history — chủ: catalog. Lịch sử danh mục.
CREATE TABLE catalog_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity text NOT NULL,
    entity_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_history_entity_check CHECK ((entity = ANY (ARRAY['site'::text, 'cabinet'::text, 'device_type'::text, 'vendor'::text, 'department'::text, 'isp_provider'::text, 'service_port'::text]))),
    CONSTRAINT catalog_history_pkey PRIMARY KEY (id)
);
CREATE INDEX catalog_history_entity_idx ON catalog_history USING btree (entity, entity_id, created_at DESC);
CREATE TRIGGER catalog_history_no_delete BEFORE DELETE ON catalog_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER catalog_history_no_truncate BEFORE TRUNCATE ON catalog_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER catalog_history_no_update BEFORE UPDATE ON catalog_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
REVOKE UPDATE, DELETE, TRUNCATE ON catalog_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON catalog_history FROM CURRENT_USER;

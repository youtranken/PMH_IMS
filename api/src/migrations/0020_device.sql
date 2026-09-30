-- device — chủ: devices (FR-001, FR-007, AD-3). Không có xoá: thiết bị chỉ chuyển trạng thái;
-- sổ tài sản mà xoá được thì kiểm kê không tin được. `search_norm` là cột sinh đã gấp dấu cho ô
-- tìm kiếm. `device_cabinet_same_site_fkey` là MATCH SIMPLE: thiết bị không nằm trong tủ không
-- bị xét.
CREATE TABLE device (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code citext NOT NULL,
    name text NOT NULL,
    device_type_id uuid NOT NULL,
    model text,
    serial text,
    site_id uuid,
    cabinet_id uuid,
    vendor_id uuid,
    assigned_to text,
    department text,
    purchase_date date,
    warranty_start date,
    warranty_end date,
    status text DEFAULT 'in_use'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_norm text GENERATED ALWAYS AS (ims_norm((((((((((((code)::text || ' '::text) || name) || ' '::text) || COALESCE(serial, ''::text)) || ' '::text) || COALESCE(model, ''::text)) || ' '::text) || COALESCE(assigned_to, ''::text)) || ' '::text) || COALESCE(department, ''::text)))) STORED,
    CONSTRAINT device_status_check CHECK ((status = ANY (ARRAY['in_use'::text, 'spare'::text, 'broken'::text, 'retired'::text]))),
    CONSTRAINT device_warranty_range_check CHECK (((warranty_start IS NULL) OR (warranty_end IS NULL) OR (warranty_end >= warranty_start))),
    CONSTRAINT device_code_key UNIQUE (code),
    CONSTRAINT device_pkey PRIMARY KEY (id),
    CONSTRAINT device_cabinet_id_fkey FOREIGN KEY (cabinet_id) REFERENCES cabinet(id) ON DELETE RESTRICT,
    CONSTRAINT device_cabinet_same_site_fkey FOREIGN KEY (site_id, cabinet_id) REFERENCES cabinet(site_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT device_device_type_id_fkey FOREIGN KEY (device_type_id) REFERENCES device_type(id) ON DELETE RESTRICT,
    CONSTRAINT device_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
    CONSTRAINT device_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendor(id) ON DELETE RESTRICT
);
CREATE INDEX device_assigned_code_idx ON device USING btree (assigned_to, code);
CREATE INDEX device_cabinet_idx ON device USING btree (cabinet_id);
CREATE INDEX device_name_code_idx ON device USING btree (name, code);
CREATE INDEX device_search_norm_trgm ON device USING gin (search_norm gin_trgm_ops);
CREATE INDEX device_serial_code_idx ON device USING btree (serial, code);
CREATE INDEX device_serial_idx ON device USING btree (lower(serial)) WHERE (serial IS NOT NULL);
CREATE INDEX device_site_idx ON device USING btree (site_id);
CREATE INDEX device_status_code_idx ON device USING btree (status, code);
CREATE INDEX device_status_idx ON device USING btree (status);
CREATE INDEX device_type_idx ON device USING btree (device_type_id);
CREATE INDEX device_warranty_code_idx ON device USING btree (warranty_end, code);
CREATE INDEX device_warranty_idx ON device USING btree (warranty_end) WHERE (status <> 'retired'::text);
CREATE INDEX device_warranty_sort_asc_idx ON device USING btree (((status = 'retired'::text)), warranty_end, code);
CREATE INDEX device_warranty_sort_desc_idx ON device USING btree (((status = 'retired'::text)), warranty_end DESC NULLS LAST, code DESC);

-- device_history — lịch sử thiết bị.
CREATE TABLE device_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_history_pkey PRIMARY KEY (id),
    CONSTRAINT device_history_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT
);
CREATE INDEX device_history_device_idx ON device_history USING btree (device_id, created_at DESC);
CREATE TRIGGER device_history_no_delete BEFORE DELETE ON device_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER device_history_no_truncate BEFORE TRUNCATE ON device_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER device_history_no_update BEFORE UPDATE ON device_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON device_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON device_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'device_history', 'UPDATE') THEN
    GRANT UPDATE ON device_history TO CURRENT_USER;
  END IF;
END $$;

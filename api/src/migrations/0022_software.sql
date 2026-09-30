-- software — chủ: software (FR-008, FR-009, AD-3). Không có cột key: chìa khoá và mật khẩu nằm
-- trong két (`secret`), không ở đây.
CREATE TABLE software (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code citext NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    vendor_id uuid,
    seat_total integer,
    start_date date,
    end_date date,
    note text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    license_model text DEFAULT 'subscription'::text NOT NULL,
    search_norm text GENERATED ALWAYS AS (ims_norm((((((code)::text || ' '::text) || name) || ' '::text) || COALESCE(note, ''::text)))) STORED,
    websites text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT software_kind_check CHECK ((kind = ANY (ARRAY['license'::text, 'ssl'::text, 'domain'::text, 'maintenance'::text, 'other'::text]))),
    CONSTRAINT software_license_model_check CHECK ((license_model = ANY (ARRAY['subscription'::text, 'perpetual'::text]))),
    CONSTRAINT software_perpetual_has_no_end_check CHECK (((license_model <> 'perpetual'::text) OR (end_date IS NULL))),
    CONSTRAINT software_perpetual_only_license_check CHECK (((license_model <> 'perpetual'::text) OR (kind = 'license'::text))),
    CONSTRAINT software_range_check CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT software_seat_check CHECK (((seat_total IS NULL) OR (seat_total > 0))),
    CONSTRAINT software_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired_ok'::text, 'retired'::text]))),
    CONSTRAINT software_code_key UNIQUE (code),
    CONSTRAINT software_pkey PRIMARY KEY (id),
    CONSTRAINT software_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendor(id) ON DELETE RESTRICT
);
CREATE INDEX software_end_code_idx ON software USING btree (end_date, code);
CREATE INDEX software_end_idx ON software USING btree (end_date) WHERE (status <> 'retired'::text);
CREATE INDEX software_kind_code_idx ON software USING btree (kind, code);
CREATE INDEX software_kind_idx ON software USING btree (kind);
CREATE INDEX software_name_code_idx ON software USING btree (name, code);
CREATE INDEX software_search_norm_trgm ON software USING gin (search_norm gin_trgm_ops);
CREATE INDEX software_seats_code_idx ON software USING btree (seat_total, code);
CREATE INDEX software_start_code_idx ON software USING btree (start_date, code);
CREATE INDEX software_status_code_idx ON software USING btree (status, code);
CREATE INDEX software_vendor_idx ON software USING btree (vendor_id);

-- software_history — lịch sử phần mềm.
CREATE TABLE software_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    software_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT software_history_pkey PRIMARY KEY (id),
    CONSTRAINT software_history_software_id_fkey FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE RESTRICT
);
CREATE INDEX software_history_idx ON software_history USING btree (software_id, created_at DESC);
CREATE TRIGGER software_history_no_delete BEFORE DELETE ON software_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER software_history_no_truncate BEFORE TRUNCATE ON software_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER software_history_no_update BEFORE UPDATE ON software_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON software_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON software_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'software_history', 'UPDATE') THEN
    GRANT UPDATE ON software_history TO CURRENT_USER;
  END IF;
END $$;

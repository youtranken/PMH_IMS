-- service_account — chủ: service-accounts. Tài khoản dùng chung và VPN: két chỉ gắn được vào
-- thiết bị/phần mềm/đường truyền, nên tài khoản không thuộc thứ nào cần chỗ đứng riêng.
CREATE TABLE service_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code citext NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    login text,
    department text,
    owner_name text,
    group_name text,
    allowed_ips text,
    note text,
    status text DEFAULT 'active'::text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_norm text GENERATED ALWAYS AS (ims_norm((((((((((code)::text || ' '::text) || name) || ' '::text) || COALESCE(login, ''::text)) || ' '::text) || COALESCE(department, ''::text)) || ' '::text) || COALESCE(owner_name, ''::text)))) STORED,
    CONSTRAINT service_account_kind_check CHECK ((kind = ANY (ARRAY['shared'::text, 'vpn'::text]))),
    CONSTRAINT service_account_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT service_account_pkey PRIMARY KEY (id)
);
CREATE INDEX service_account_kind_code_idx ON service_account USING btree (kind, code);
CREATE INDEX service_account_kind_idx ON service_account USING btree (kind) WHERE (status = 'active'::text);
CREATE INDEX service_account_name_code_idx ON service_account USING btree (name, code);
CREATE INDEX service_account_search_norm_trgm ON service_account USING gin (search_norm gin_trgm_ops);
CREATE INDEX service_account_status_code_idx ON service_account USING btree (status, code);
CREATE UNIQUE INDEX service_account_code_uq ON service_account USING btree (code);

-- service_account_history — lịch sử tài khoản dịch vụ.
CREATE TABLE service_account_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_account_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_account_history_pkey PRIMARY KEY (id),
    CONSTRAINT service_account_history_service_account_id_fkey FOREIGN KEY (service_account_id) REFERENCES service_account(id) ON DELETE RESTRICT
);
CREATE INDEX service_account_history_idx ON service_account_history USING btree (service_account_id, created_at DESC);
CREATE TRIGGER service_account_history_no_delete BEFORE DELETE ON service_account_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER service_account_history_no_truncate BEFORE TRUNCATE ON service_account_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER service_account_history_no_update BEFORE UPDATE ON service_account_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
REVOKE UPDATE, DELETE, TRUNCATE ON service_account_history FROM ims_app;

-- Không còn trigger nào gọi hàm này: service_account_history dùng history_append_only() như các
-- bảng lịch sử khác.
CREATE FUNCTION service_account_history_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'service_account_history là append-only (AD-13)';
END;
$$;

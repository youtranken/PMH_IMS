-- nat_rule — chủ: ipam (FR-017). Sổ NAT/port-forward. `nat_rule_no_overlap` là trọng tài ở DB:
-- TCP và UDP cùng cổng được phép (Draytek cho khai riêng), còn "both" chồng lên cả hai.
CREATE TABLE nat_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    protocol text NOT NULL,
    external_from integer NOT NULL,
    external_to integer NOT NULL,
    internal_ip inet NOT NULL,
    internal_port integer NOT NULL,
    ip_address_id uuid,
    used_by text NOT NULL,
    reason text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    note text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by text,
    void_reason text,
    search_norm text GENERATED ALWAYS AS (ims_norm(((((used_by || ' '::text) || reason) || ' '::text) || host(internal_ip)))) STORED,
    CONSTRAINT nat_external_range_check CHECK (external_from BETWEEN 1 AND 65535 AND external_to BETWEEN 1 AND 65535 AND external_from <= external_to),
    CONSTRAINT nat_internal_ipv4_check CHECK ((family(internal_ip) = 4)),
    CONSTRAINT nat_internal_port_check CHECK (((internal_port >= 1) AND (internal_port <= 65535))),
    CONSTRAINT nat_protocol_check CHECK ((protocol = ANY (ARRAY['tcp'::text, 'udp'::text, 'both'::text]))),
    CONSTRAINT nat_void_check CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (void_reason IS NOT NULL)))),
    CONSTRAINT nat_rule_no_overlap EXCLUDE USING gist (device_id WITH =, (
CASE protocol
    WHEN 'tcp'::text THEN int4range(1, 1, '[]'::text)
    WHEN 'udp'::text THEN int4range(2, 2, '[]'::text)
    ELSE int4range(1, 2, '[]'::text)
END) WITH &&, int4range(external_from, external_to, '[]'::text) WITH &&) WHERE ((voided_at IS NULL)),
    CONSTRAINT nat_rule_pkey PRIMARY KEY (id),
    CONSTRAINT nat_rule_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT,
    CONSTRAINT nat_rule_ip_address_id_fkey FOREIGN KEY (ip_address_id) REFERENCES ip_address(id) ON DELETE SET NULL
);
CREATE INDEX nat_rule_device_idx ON nat_rule USING btree (device_id) WHERE (voided_at IS NULL);
CREATE INDEX nat_rule_internal_host_idx ON nat_rule USING btree (host(internal_ip)) WHERE (voided_at IS NULL);
CREATE INDEX nat_rule_ip_idx ON nat_rule USING btree (ip_address_id) WHERE (voided_at IS NULL);
CREATE INDEX nat_rule_search_norm_trgm ON nat_rule USING gin (search_norm gin_trgm_ops);

-- nat_rule_history — "ai mở cổng nào ra ngoài, khi nào, vì sao".
CREATE TABLE nat_rule_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nat_rule_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nat_rule_history_pkey PRIMARY KEY (id),
    CONSTRAINT nat_rule_history_nat_rule_id_fkey FOREIGN KEY (nat_rule_id) REFERENCES nat_rule(id) ON DELETE RESTRICT
);
CREATE INDEX nat_rule_history_rule_idx ON nat_rule_history USING btree (nat_rule_id, created_at DESC);
CREATE TRIGGER nat_rule_history_no_delete BEFORE DELETE ON nat_rule_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER nat_rule_history_no_truncate BEFORE TRUNCATE ON nat_rule_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER nat_rule_history_no_update BEFORE UPDATE ON nat_rule_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON nat_rule_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON nat_rule_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'nat_rule_history', 'UPDATE') THEN
    GRANT UPDATE ON nat_rule_history TO CURRENT_USER;
  END IF;
END $$;

-- isp_line — chủ: software (FR-010): cùng nhà với license vì đều là hợp đồng có ngày gia hạn.
-- `provider` là BẢN SAO tên nhà mạng để cột sinh, sắp xếp, xuất Excel đọc được mà không join
-- chéo module (AD-2); khoá ngoại kép (provider_id, provider) ON UPDATE CASCADE giữ bản sao không
-- bao giờ lệch (Q-11). `wan_ip` là inet: một IP mỗi đường (Q-04).
CREATE TABLE isp_line (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code citext NOT NULL,
    provider citext NOT NULL,
    bandwidth text,
    wan_ip inet,
    site_id uuid,
    device_id uuid,
    hotline text,
    contract_no text,
    start_date date,
    end_date date,
    note text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_id uuid NOT NULL,
    search_norm text GENERATED ALWAYS AS (ims_norm((((((((code)::text || ' '::text) || (provider)::text) || ' '::text) || COALESCE(abbrev(wan_ip), ''::text)) || ' '::text) || COALESCE(contract_no, ''::text)))) STORED,
    CONSTRAINT isp_line_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'terminated'::text]))),
    CONSTRAINT isp_line_code_key UNIQUE (code),
    CONSTRAINT isp_line_pkey PRIMARY KEY (id),
    CONSTRAINT isp_line_device_id_fkey FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE RESTRICT,
    CONSTRAINT isp_line_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES isp_provider(id) ON DELETE RESTRICT,
    CONSTRAINT isp_line_provider_name_fkey FOREIGN KEY (provider_id, provider) REFERENCES isp_provider(id, name) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT isp_line_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT
);
CREATE INDEX isp_line_contract_code_idx ON isp_line USING btree (contract_no, code);
CREATE INDEX isp_line_device_idx ON isp_line USING btree (device_id) WHERE (device_id IS NOT NULL);
CREATE INDEX isp_line_hotline_code_idx ON isp_line USING btree (hotline, code);
CREATE INDEX isp_line_provider_code_idx ON isp_line USING btree (provider, code);
CREATE INDEX isp_line_provider_id_idx ON isp_line USING btree (provider_id);
CREATE INDEX isp_line_provider_idx ON isp_line USING btree (provider);
CREATE INDEX isp_line_search_norm_trgm ON isp_line USING gin (search_norm gin_trgm_ops);
CREATE INDEX isp_line_site_idx ON isp_line USING btree (site_id);
CREATE INDEX isp_line_status_code_idx ON isp_line USING btree (status, code);

-- isp_line_history — lịch sử đường truyền.
CREATE TABLE isp_line_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    isp_line_id uuid NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT isp_line_history_pkey PRIMARY KEY (id),
    CONSTRAINT isp_line_history_isp_line_id_fkey FOREIGN KEY (isp_line_id) REFERENCES isp_line(id) ON DELETE RESTRICT
);
CREATE INDEX isp_line_history_idx ON isp_line_history USING btree (isp_line_id, created_at DESC);
CREATE TRIGGER isp_line_history_no_delete BEFORE DELETE ON isp_line_history FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER isp_line_history_no_truncate BEFORE TRUNCATE ON isp_line_history FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER isp_line_history_no_update BEFORE UPDATE ON isp_line_history FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm (NFR-03, AD-13): ims_app chỉ SELECT + INSERT; trigger chặn UPDATE/DELETE/TRUNCATE.
-- Thu cả quyền của chính chủ sở hữu, để một câu UPDATE tay nhầm bảng dừng ở ACL trước khi tới
-- trigger (vô hiệu với superuser, có hiệu lực với `ims_owner` — DB-03).
-- Nhưng trả lại UPDATE cho chủ sở hữu không superuser: phép kiểm khoá ngoại khi xoá bảng cha
-- (`SELECT … FOR KEY SHARE` trên bảng con) chạy bằng quyền CHỦ bảng con và cần UPDATE, thiếu nó
-- thì mọi lệnh xoá bảng cha chết với "permission denied". Trigger vẫn chặn mọi UPDATE/DELETE, và
-- ims_app không được gì thêm. Superuser thì has_table_privilege luôn đúng nên không cấp gì.
REVOKE UPDATE, DELETE, TRUNCATE ON isp_line_history FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON isp_line_history FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'isp_line_history', 'UPDATE') THEN
    GRANT UPDATE ON isp_line_history TO CURRENT_USER;
  END IF;
END $$;

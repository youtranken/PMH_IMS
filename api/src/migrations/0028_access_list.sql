-- access_list — chủ: vault. Ma trận quyền xem két: người × nhóm đối tượng × tầng (FR-023). Nhóm
-- nhà mạng khoá bằng ID danh mục, không bằng tên (SEC-13, Q-11): đổi tên không được lặng lẽ tước
-- quyền.
CREATE TABLE access_list (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_email citext NOT NULL,
    scope_type text NOT NULL,
    scope_ref text NOT NULL,
    tier text NOT NULL,
    granted_by text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_scope_check CHECK ((scope_type = ANY (ARRAY['device_site'::text, 'device_type'::text, 'software_kind'::text, 'service_account_kind'::text, 'isp_provider'::text]))),
    CONSTRAINT access_tier_check CHECK ((tier = ANY (ARRAY['whitelist'::text, 'needs_approval'::text]))),
    CONSTRAINT access_list_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX access_list_key ON access_list USING btree (member_email, scope_type, scope_ref);

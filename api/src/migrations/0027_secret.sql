-- secret — chủ: vault (FR-021, NFR-02, AD-4). CHỈ `vault` đụng bảng này (dependency-cruiser
-- chặn). Plaintext không bao giờ chạm bảng: chỉ ciphertext + IV + tag + DEK đã bọc + key_version;
-- AAD gồm bảng, record_id, key_version nên ciphertext bê sang hàng khác là giải không ra. Tham
-- chiếu chủ thể LỎNG (không FK) vì vault không được biết bảng của module khác. Thu hồi = xoá mềm.
CREATE TABLE secret (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    username text,
    value_ct bytea NOT NULL,
    value_iv bytea NOT NULL,
    value_tag bytea NOT NULL,
    dek_wrapped bytea NOT NULL,
    key_version integer NOT NULL,
    note text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by text,
    value_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    value_changed_by text,
    CONSTRAINT secret_kind_check CHECK ((kind = ANY (ARRAY['password'::text, 'license_key'::text, 'other'::text]))),
    CONSTRAINT secret_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'software'::text, 'service_account'::text, 'isp'::text]))),
    CONSTRAINT secret_revoke_check CHECK (((revoked_at IS NULL) = (revoked_by IS NULL))),
    CONSTRAINT secret_pkey PRIMARY KEY (id)
);
CREATE INDEX secret_owner_idx ON secret USING btree (owner_type, owner_id) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX secret_label_key ON secret USING btree (owner_type, owner_id, lower(label)) WHERE (revoked_at IS NULL);

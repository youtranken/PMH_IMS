-- file — chủ: files. Tệp đính kèm (FR-002, FR-010): nội dung trên volume, DB giữ metadata.
CREATE TABLE file (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_name text NOT NULL,
    stored_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT file_owner_type_check CHECK ((owner_type = ANY (ARRAY['device'::text, 'isp'::text, 'software'::text, 'service_account'::text, 'subnet'::text, 'nat_rule'::text]))),
    CONSTRAINT file_pkey PRIMARY KEY (id),
    CONSTRAINT file_stored_name_key UNIQUE (stored_name),
    CONSTRAINT file_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE INDEX file_owner_idx ON file USING btree (owner_type, owner_id) WHERE (deleted_at IS NULL);

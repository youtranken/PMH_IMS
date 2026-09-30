-- cabinet — chủ: catalog. Mã tủ chỉ duy nhất TRONG một site. `cabinet_site_id_key` (site_id, id)
-- là đích của khoá ngoại kép từ `device`: thiết bị trong tủ phải cùng site với tủ, và tủ còn
-- thiết bị thì không dời site được.
CREATE TABLE cabinet (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    code citext NOT NULL,
    description text,
    u_height integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cabinet_u_height_check CHECK (((u_height IS NULL) OR ((u_height > 0) AND (u_height <= 60)))),
    CONSTRAINT cabinet_code_per_site_key UNIQUE (site_id, code),
    CONSTRAINT cabinet_pkey PRIMARY KEY (id),
    CONSTRAINT cabinet_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX cabinet_site_id_key ON cabinet USING btree (site_id, id);

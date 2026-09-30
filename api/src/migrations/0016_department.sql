-- department — chủ: catalog. Bộ phận; thay ô gõ tự do, vì "P. Kế toán" / "KT" là hai bộ phận
-- khác nhau với máy.
CREATE TABLE department (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    description text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT department_name_key UNIQUE (name),
    CONSTRAINT department_pkey PRIMARY KEY (id)
);

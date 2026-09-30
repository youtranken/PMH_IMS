-- vendor — chủ: catalog. Nhà cung cấp.
CREATE TABLE vendor (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    supplies text,
    phone text,
    contact text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_name_key UNIQUE (name),
    CONSTRAINT vendor_pkey PRIMARY KEY (id)
);

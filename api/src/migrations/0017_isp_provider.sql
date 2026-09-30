-- isp_provider — chủ: catalog. `isp_provider_id_name_key` (id, name) là đích của khoá ngoại kép
-- từ `isp_line` (Q-11): đổi tên nhà mạng thì bản sao tên trên đường truyền đổi theo.
CREATE TABLE isp_provider (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name citext NOT NULL,
    hotline text,
    contact text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT isp_provider_id_name_key UNIQUE (id, name),
    CONSTRAINT isp_provider_name_key UNIQUE (name),
    CONSTRAINT isp_provider_pkey PRIMARY KEY (id)
);

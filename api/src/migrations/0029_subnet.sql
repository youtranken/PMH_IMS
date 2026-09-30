-- subnet — chủ: ipam (FR-018..FR-020, AD-3). Kiểu cidr/inet chứ không text: có `<<=`, sắp đúng
-- thứ tự số, không nhận chuỗi rác. Không xoá hẳn: ẩn (voided_at), vẫn tra được. Hai dải ĐANG
-- DÙNG không được chồng nhau (Q-01).
CREATE TABLE subnet (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    cidr cidr NOT NULL,
    site_id uuid,
    description text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by text,
    void_reason text,
    vlan integer,
    gateway inet,
    CONSTRAINT subnet_gateway_within_check CHECK (((gateway IS NULL) OR (gateway <<= (cidr)::inet))),
    CONSTRAINT subnet_ipv4_check CHECK ((family((cidr)::inet) = 4)),
    CONSTRAINT subnet_vlan_check CHECK (((vlan IS NULL) OR ((vlan >= 1) AND (vlan <= 4094)))),
    CONSTRAINT subnet_void_check CHECK ((((voided_at IS NULL) AND (voided_by IS NULL) AND (void_reason IS NULL)) OR ((voided_at IS NOT NULL) AND (voided_by IS NOT NULL) AND (void_reason IS NOT NULL)))),
    CONSTRAINT subnet_no_overlap EXCLUDE USING gist (cidr inet_ops WITH &&) WHERE ((voided_at IS NULL)),
    CONSTRAINT subnet_pkey PRIMARY KEY (id),
    CONSTRAINT subnet_site_id_fkey FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT
);
CREATE INDEX subnet_site_idx ON subnet USING btree (site_id) WHERE (voided_at IS NULL);
CREATE UNIQUE INDEX subnet_cidr_key ON subnet USING btree (cidr) WHERE (voided_at IS NULL);

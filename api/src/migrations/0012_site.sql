-- site — chủ: catalog (FR-004, AD-3), như mọi bảng danh mục: module khác đọc qua
-- CatalogApiService. Mọi khoá ngoại trỏ vào danh mục là RESTRICT: mục đang được tham chiếu không
-- xoá được, chỉ vô hiệu. `catalog` không được biết tầng nghiệp vụ (AD-2) nên không tự đi đếm —
-- Postgres chặn, service đổi 23503 thành CATALOG_IN_USE.
CREATE TABLE site (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code citext NOT NULL,
    name text NOT NULL,
    address text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT site_code_key UNIQUE (code),
    CONSTRAINT site_pkey PRIMARY KEY (id)
);

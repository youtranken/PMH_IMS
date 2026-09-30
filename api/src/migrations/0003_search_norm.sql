-- unaccent: gấp dấu tiếng Việt cho ô tìm kiếm. Cột sinh `search_norm` của các bảng gọi ims_norm.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Gấp dấu cho tìm kiếm. `unaccent()` của contrib là STABLE, mà cột sinh và chỉ mục chỉ nhận
-- IMMUTABLE, nên phải bọc lại. Kết quả phải Y HỆT foldSearch() ở api lẫn web (bảng chuẩn chung:
-- ops/search-fold-cases.json) — lệch một ký tự là gõ không dấu không ra dòng có dấu.
CREATE FUNCTION ims_norm(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN lower(public.unaccent('public.unaccent'::regdictionary, value));

COMMENT ON FUNCTION ims_norm(value text) IS 'Gấp dấu tiếng Việt cho tìm kiếm. Phải cho kết quả Y HỆT foldSearch() ở api/src/common/search-fold.ts và web/src/lib/search-fold.ts. Bảng chuẩn dùng chung: ops/search-fold-cases.json.';

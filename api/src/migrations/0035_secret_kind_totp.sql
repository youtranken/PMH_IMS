-- secret: thêm loại ngăn 'totp' ("Mã 2 lớp", Q-18, mở rộng FR-021). Giá trị vẫn đi qua
-- envelope như mọi ngăn, cột không đổi. Chỉ nới CHECK: mọi hàng đang có đều thoả luật mới nên
-- lượt kiểm lại khi ADD không từ chối gì. Whitelist này có bản sao ở `SECRET_KINDS` (api) và
-- `SecretKind` (web) — thêm loại phải sửa đủ ba chỗ.
ALTER TABLE secret DROP CONSTRAINT secret_kind_check;
ALTER TABLE secret ADD CONSTRAINT secret_kind_check
    CHECK ((kind = ANY (ARRAY['password'::text, 'license_key'::text, 'totp'::text, 'other'::text])));

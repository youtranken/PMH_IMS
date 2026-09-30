-- Q-17: lược đồ IMS gộp theo bảng. Mỗi file là TRẠNG THÁI CUỐI của một bảng (hoặc một cụm bảng
-- cùng chủ sở hữu, AD-3): cột, ràng buộc, chỉ mục, trigger, quyền và dữ liệu gieo của nó nằm
-- cùng một chỗ. Thứ tự file theo phụ thuộc khoá ngoại.
--
-- Luật như mọi migration (AD-10): file đã apply thì KHÔNG sửa nữa, kể cả chú thích — runner so
-- checksum cả file. Đổi lược đồ = thêm file mới đánh số tiếp theo.
--
-- Mọi file chạy được bằng superuser lẫn bằng role chủ sở hữu không superuser (DB-03): không câu
-- nào ghi tên role chủ sở hữu; quyền của chính role đang chạy viết bằng CURRENT_USER.

-- Extension "trusted" nên role chủ sở hữu không superuser cài được (DB-03).
--   pgcrypto   gen_random_uuid() cho khoá chính
--   citext     mã/email/tên so không phân biệt hoa thường
--   pg_trgm    chỉ mục trigram cho ô tìm kiếm `ILIKE '%…%'`
--   btree_gist ràng buộc EXCLUDE trộn cột thường (=) với dải (&&): sổ NAT, dải IP
-- unaccent cài ở file search_norm, cùng hàm dùng nó.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

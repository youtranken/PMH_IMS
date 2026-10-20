-- Cột `code` của phiếu ISO theo quy ước citext chung của repo (`audit-index.spec.ts`): tra số phiếu
-- "0206-2026-001" hay mã bộ phận gõ chữ thường vẫn khớp. Bảng còn ít hàng nên đổi kiểu tại chỗ.
ALTER TABLE iso_division ALTER COLUMN code TYPE citext;
ALTER TABLE iso_incident ALTER COLUMN code TYPE citext;

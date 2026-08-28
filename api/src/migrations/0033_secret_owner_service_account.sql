-- Két sắt nhận thêm chủ thể 'service_account' (0032).
--
-- Bẫy đã sập ở đây, ghi lại cho lần sau: whitelist chủ thể của két sắt nằm ở BA chỗ —
--   1. `SECRET_OWNER_TYPES` trong `vault.service.ts`  (đã sửa)
--   2. `SecretOwnerType` phía web trong `vault-panel.tsx` (đã sửa)
--   3. CHECK constraint này ở tầng DB  ← chỗ bị quên
-- Sửa hai chỗ đầu thì TypeScript xanh, `npm run build` xanh, mọi test đơn vị xanh; chỉ tới
-- lúc chạy thật mới ra 500 vì Postgres từ chối. Tầng DB là chốt chặn cuối và nó không biết
-- gì về TypeScript.
ALTER TABLE secret DROP CONSTRAINT secret_owner_type_check;
ALTER TABLE secret ADD CONSTRAINT secret_owner_type_check
  CHECK (owner_type IN ('device', 'software', 'service_account'));

-- NFR-03 append-only ở TẦNG DB, không chỉ ở code: role app không sửa/xóa được audit.
-- (role ims_app do docker entrypoint tạo; câu REVOKE chạy được kể cả khi role chưa tồn tại
--  thì bỏ qua — nên dùng DO block.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM %I', current_user);
  END IF;
END $$;

-- Lưới thứ hai: trigger chặn UPDATE/DELETE kể cả khi kết nối bằng superuser.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log là append-only (NFR-03): cấm % ', TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

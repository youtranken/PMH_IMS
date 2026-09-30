-- Role ứng dụng `ims_app` (D-01, AD-9): không superuser, không sở hữu bảng nào, nên không
-- `ALTER TABLE … DISABLE TRIGGER` hay DROP được. Role chạy migration là CHỦ SỞ HỮU và chỉ dùng
-- để chạy migration. Mật khẩu của ims_app do api đặt lúc khởi động (ensureAppRole), không nằm
-- trong file nào đi vào git.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    -- NOLOGIN: vỏ trước, mật khẩu lúc boot. Role LOGIN mà chưa có mật khẩu là cửa mở.
    CREATE ROLE ims_app NOLOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ims_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO ims_app;

-- Quyền mặc định gắn vào role chạy file: mọi bảng, hàm tạo từ đây về sau (kể cả ở các file
-- tiếp theo) tự có quyền cho ims_app. Vì thế bảng chỉ-thêm phải tự REVOKE ngay trong file tạo
-- nó, và thêm vào api/test/app-role-privileges.spec.ts.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ims_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ims_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ims_app;

-- Quyền mặc định chỉ áp cho đối tượng tạo SAU nó; hàm của các extension ở 0000 thì đã có.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ims_app;

-- Journal migration (runner tạo trước file đầu tiên) không phải việc của ứng dụng.
REVOKE ALL ON TABLE _migrations FROM ims_app;

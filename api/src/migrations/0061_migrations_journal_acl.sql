-- DB-01: ims_app nhận `GRANT ... ON ALL TABLES` ở 0048, quét trúng cả sổ `_migrations` do bộ chạy
-- tạo trước đó. Lộ api mà sửa được sổ này là xoá được dòng journal (lần boot sau chết) hoặc chèn
-- sẵn tên một migration tương lai để nó bị bỏ qua. Ứng dụng không bao giờ cần đọc sổ này.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    REVOKE ALL ON TABLE _migrations FROM ims_app;
  END IF;
END $$;

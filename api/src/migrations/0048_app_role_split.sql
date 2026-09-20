/*
 * TÁCH ROLE ỨNG DỤNG KHỎI ROLE CHỦ SỞ HỮU (20/09/2026) — D-01 của rà soát 19/09.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `SELECT rolsuper FROM pg_roles WHERE rolname = 'ims'` trả `t`. Ứng dụng kết nối bằng chính
 * role đó, và role đó vừa là SUPERUSER vừa là CHỦ SỞ HỮU mọi bảng. Hậu quả:
 *
 *  1. Câu `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log` ở `0005_audit_append_only.sql` là
 *     TRANG TRÍ — superuser bỏ qua toàn bộ ACL. Chú thích của chính migration ấy nói "role
 *     ims_app do docker entrypoint tạo"; role đó chưa bao giờ tồn tại.
 *  2. AD-9 ("REVOKE UPDATE/DELETE ở tầng DB role") vì thế KHÔNG ĐÚNG với thực tế đang chạy.
 *  3. Trigger `audit_log_no_update`/`no_delete` là lưới thật, nhưng `0039` đã tự khai lỗ còn
 *     lại: CHỦ SỞ HỮU làm được `ALTER TABLE ... DISABLE TRIGGER ALL`. Ai cầm `DATABASE_URL`
 *     là gọt sạch dấu vết được, không lớp nào ghi lại.
 *
 * NFR-03 nói sổ cái chỉ-thêm. Tới hôm nay nó chỉ-thêm với những người TỬ TẾ.
 *
 * ===== HÌNH DẠNG BẢN VÁ =====
 *
 *   `ims`      — chủ sở hữu. Chạy migration, và CHỈ chạy migration.
 *   `ims_app`  — role ứng dụng. Đọc/ghi dữ liệu nghiệp vụ, CHỈ THÊM vào `audit_log`, không sở
 *                hữu bảng nào nên không `DISABLE TRIGGER` được, không `DROP` được, không
 *                `ALTER` được.
 *
 * Migration này chỉ dựng role và phát quyền. Mật khẩu đăng nhập của `ims_app` do lúc khởi
 * động API đặt (`ensureAppRole` trong `main.ts`), đọc từ biến môi trường — không có bí mật
 * nào nằm trong file migration đi vào git.
 *
 * ===== VÌ SAO CÓ `ALTER DEFAULT PRIVILEGES` =====
 *
 * Không có nó, migration 0049 tạo bảng mới là ứng dụng mất quyền trên đúng bảng đó — và lỗi
 * lộ ra ở production, dưới dạng một câu "permission denied" giữa một nghiệp vụ. Quyền mặc
 * định gắn vào role CHỦ SỞ HỮU, nên mọi bảng nó tạo về sau tự có quyền đúng.
 */
DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    -- NOLOGIN: dựng cái vỏ ở đây, còn mật khẩu thì lúc boot mới đặt. Role không mật khẩu
    -- mà đã LOGIN được là một tài khoản mở toang trong khoảng giữa hai bước.
    CREATE ROLE ims_app NOLOGIN;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ims_app', current_database());
  EXECUTE 'GRANT USAGE ON SCHEMA public TO ims_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ims_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ims_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ims_app';

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    || 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ims_app',
    owner_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    || 'GRANT USAGE, SELECT ON SEQUENCES TO ims_app',
    owner_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    || 'GRANT EXECUTE ON FUNCTIONS TO ims_app',
    owner_role
  );

  /*
   * Và đây là câu mà 0005 định viết. Lần này nó có hiệu lực, vì `ims_app` không phải
   * superuser và không sở hữu bảng: SELECT + INSERT, hết.
   *
   * TRUNCATE nằm trong REVOKE cùng UPDATE/DELETE — trigger BEFORE UPDATE/DELETE không bắt
   * được TRUNCATE (nó không chạy per-row), nên ACL là hàng rào DUY NHẤT cho đường đó.
   */
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ims_app';
END $$;

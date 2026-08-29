-- NFR-03/AD-13 — bịt đường vòng TRUNCATE của mọi bảng chỉ-thêm.
--
-- VẤN ĐỀ ĐANG CÓ. Từ 0005 tới 0037, mỗi bảng chỉ-thêm được bảo vệ bằng hai lớp:
--   (1) `REVOKE UPDATE, DELETE, TRUNCATE ... FROM current_user`
--   (2) trigger `BEFORE UPDATE/DELETE ... FOR EACH ROW`
-- Lớp (1) là NO-OP. Chú thích ở 0005 nói "role ims_app do docker entrypoint tạo", nhưng
-- `ims_app` không tồn tại ở bất kỳ đâu trong repo — grep toàn bộ chỉ ra đúng dòng chú thích
-- đó. Thực tế api nối bằng `POSTGRES_USER`, tức superuser do entrypoint của ảnh postgres tạo,
-- đồng thời là OWNER mọi bảng. Superuser bỏ qua toàn bộ kiểm tra ACL, nên `REVOKE` với chính
-- nó không có tác dụng gì.
--
-- Lớp (2) thì thật — trigger nổ kể cả với superuser. NHƯNG trigger FOR EACH ROW **không chạy
-- khi TRUNCATE**. Nên `TRUNCATE audit_log` xóa sạch nhật ký an ninh mà không lớp nào cản.
--
-- Migration này đóng đúng lỗ đó bằng trigger cấp CÂU LỆNH, thứ TRUNCATE có kích hoạt.
--
-- CÒN LẠI (chưa đóng được ở đây): `ALTER TABLE ... DISABLE TRIGGER` và `DROP TRIGGER` vẫn mở,
-- vì chủ bảng làm được. Bịt hẳn thì phải tách vai: app chạy bằng một role KHÔNG phải owner,
-- không phải superuser; migration chạy bằng owner riêng. Việc đó đổi cách triển khai (thêm
-- một docker secret cho mật khẩu `ims_app`, đổi DATABASE_URL của api/worker) nên tách thành
-- một bước vận hành riêng — xem `docs/CODE-REVIEW-2026-08-28.md` (F-DB-02).

CREATE OR REPLACE FUNCTION append_only_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Bảng % là chỉ-thêm (NFR-03/AD-13): cấm TRUNCATE. Nhật ký không được phép biến mất.',
    TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  -- 10 bảng chỉ-thêm hiện có. Thêm bảng lịch sử mới thì thêm tên vào đây trong CÙNG migration
  -- tạo ra nó — đừng để lần sau phải đi rà lại.
  tables text[] := ARRAY[
    'audit_log',
    'catalog_history',
    'device_history',
    'software_history',
    'isp_line_history',
    'renewal_history',
    'ip_history',
    'approval_history',
    'nat_rule_history',
    'service_account_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Bảng chỉ-thêm % không tồn tại — danh sách trong 0039 đã lệch khỏi schema.', t;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate()',
      t || '_no_truncate', t
    );
  END LOOP;
END $$;

-- `service_account_history` (0032) là bảng lịch sử DUY NHẤT thiếu hẳn khối REVOKE mà 9 bảng
-- kia đều có, và nó tự viết một hàm trigger riêng thay vì dùng `history_append_only()` dùng
-- chung — nên thông điệp lỗi của nó mất `TG_TABLE_NAME`/`TG_OP`. Đưa nó về đúng chuẩn để khi
-- tách vai `ims_app` sau này không còn một bảng lệch chuẩn nằm lẫn trong đó.
DROP TRIGGER IF EXISTS service_account_history_no_delete ON service_account_history;
CREATE TRIGGER service_account_history_no_update BEFORE UPDATE ON service_account_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER service_account_history_no_delete BEFORE DELETE ON service_account_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- DB-03 · chủ bảng (không superuser) phải có UPDATE trên mọi bảng con có khoá ngoại.
--
-- Postgres chạy phép kiểm khoá ngoại khi xoá bảng cha (`SELECT … FOR KEY SHARE` trên bảng con)
-- bằng quyền CHỦ bảng con, và khoá hàng cần UPDATE. 0039 thu UPDATE/DELETE/TRUNCATE của chính
-- role chạy migration trên các bảng lịch sử — vô hại khi đó là superuser, nhưng từ khi migration
-- chạy bằng `ims_owner` thì mọi lệnh xoá bảng cha chết với "permission denied for table …".
-- Trả riêng UPDATE là đủ: trigger chỉ-thêm (AD-13) vẫn chặn mọi lệnh UPDATE/DELETE, và
-- `ims_app` không được gì thêm.
DO $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT DISTINCT c.conrelid::regclass AS tbl
      FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid
     WHERE c.contype = 'f' AND k.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND NOT has_table_privilege(current_user, c.conrelid, 'UPDATE')
  LOOP
    EXECUTE format('GRANT UPDATE ON %s TO %I', obj.tbl, current_user);
  END LOOP;
END
$$;

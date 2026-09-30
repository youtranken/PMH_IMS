-- Trigger chặn sửa/xoá dùng chung cho mọi bảng chỉ-thêm (NFR-03, AD-13).

-- Chỉ-thêm ở TẦNG DB (NFR-03, AD-13). ACL chặn `ims_app`; trigger là lưới thứ hai, chặn cả
-- role nào lỡ được cấp quyền rộng hơn.
CREATE FUNCTION audit_log_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_log là append-only (NFR-03): cấm % ', TG_OP;
END $$;

CREATE FUNCTION history_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là append-only (AD-13): cấm %', TG_TABLE_NAME, TG_OP;
END $$;

-- Trigger BEFORE UPDATE/DELETE không bắt được TRUNCATE (không chạy theo hàng), nên mỗi bảng
-- chỉ-thêm có thêm một trigger cấp câu lệnh.
CREATE FUNCTION append_only_no_truncate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'Bảng % là chỉ-thêm (NFR-03/AD-13): cấm TRUNCATE. Nhật ký không được phép biến mất.',
    TG_TABLE_NAME;
END $$;

-- Story 3.4 (AD-13): lịch sử gia hạn, APPEND-ONLY.
-- Chủ sở hữu: module `expiry` (tầng nền).
--
-- Vì sao một bảng chung thay vì mỗi module một bảng: câu hỏi "năm ngoái gia hạn những gì,
-- hết bao nhiêu lần" là câu hỏi CẮT NGANG mọi loại (license, SSL, ISP, bảo trì). Mỗi module
-- một bảng thì phải UNION 5 chỗ mới trả lời được.
--
-- KHÔNG có khóa ngoại tới bảng của module chủ: `object_kind` + `object_id` là tham chiếu
-- lỏng, đúng tinh thần AD-2 (expiry không biết bảng nào tồn tại). Đổi lại phải chấp nhận
-- vết gia hạn của một hồ sơ bị xóa sẽ thành mồ côi — mà hệ thống này không xóa gì cả.
CREATE TABLE renewal_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_kind text NOT NULL,
  object_id   uuid NOT NULL,
  label       text NOT NULL,
  old_end     date,
  new_end     date NOT NULL,
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX renewal_history_object_idx ON renewal_history (object_kind, object_id, created_at DESC);
CREATE INDEX renewal_history_created_idx ON renewal_history (created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON renewal_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER renewal_history_no_update BEFORE UPDATE ON renewal_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER renewal_history_no_delete BEFORE DELETE ON renewal_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

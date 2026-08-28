-- Lịch sử nghiệp vụ cho SỔ NAT (AD-13).
--
-- Vì sao cần: sổ NAT là thứ auditor hỏi nhiều nhất — "ai mở port 3389 ra internet, ngày nào,
-- vì sao, và ai gỡ nó". Trước đây câu đó chỉ trả lời được bằng cách tra `audit_log` với SQL:
-- `nat_rule` không có bảng lịch sử, cũng không có tab Lịch sử ở giao diện.
--
-- Đối chiếu cho thấy đây là chỗ bị bỏ sót chứ không phải quyết định kiến trúc: `ip_address`
-- ngay bên cạnh CÓ `ip_history` và AC 5.2 bắt giữ vĩnh viễn. Một rule NAT còn nhạy hơn một hồ
-- sơ IP — nó là cái cửa mở ra internet.
--
-- CHỈ-THÊM, đúng khuôn `ip_history`: REVOKE quyền sửa/xóa + trigger `history_append_only()`.
-- Sửa được lịch sử thì lịch sử không còn là bằng chứng.
--
-- `ON DELETE RESTRICT`: rule NAT gỡ đi là `voided_at`, không DELETE — nhưng nếu sau này có ai
-- viết một câu DELETE thì ràng buộc này chặn lại, và chặn ở tầng DB chứ không trông vào việc
-- người viết nhớ luật.
CREATE TABLE nat_rule_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nat_rule_id uuid NOT NULL REFERENCES nat_rule (id) ON DELETE RESTRICT,
  action      text NOT NULL,
  actor       text NOT NULL,
  changes     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nat_rule_history_rule_idx ON nat_rule_history (nat_rule_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON nat_rule_history FROM %I', current_user);
  END IF;
END $$;

CREATE TRIGGER nat_rule_history_no_update BEFORE UPDATE ON nat_rule_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER nat_rule_history_no_delete BEFORE DELETE ON nat_rule_history
  FOR EACH ROW EXECUTE FUNCTION history_append_only();

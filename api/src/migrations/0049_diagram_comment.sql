-- Bình luận ghim trên bản vẽ — chủ: diagrams (AD-3, AD-18, Q-23). draw.io tự host không có bình
-- luận nên IMS tự lưu, gắn phiên bản + id ô trong XML.
--
-- Một luồng = một hàng gốc (`parent_id` NULL) + các hàng trả lời/sự kiện trỏ về gốc. Nội dung
-- không sửa, không xoá: "Đã xử lý" / "Mở lại" là hàng sự kiện (`kind`), không UPDATE hàng gốc —
-- người gửi duyệt và người duyệt cùng đọc lại được ai nói gì, lúc nào.
--
-- `cell_id` NULL = ghi chú chung của lượt duyệt. `anchor` là toạ độ ô trong ảnh xem lúc ghim:
-- ô bị xoá ở phiên bản sau thì ghim vẫn hiện ở vị trí cũ kèm "(hình đã bỏ)".
-- `approval_id` là lượt duyệt mà ghi chú thuộc về; không khoá ngoại sang `approval` vì bảng đó
-- thuộc module `approvals` (AD-3) — đọc qua `approvals.api`.
CREATE TABLE diagram_comment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    diagram_id uuid NOT NULL,
    version_id uuid NOT NULL,
    approval_id uuid,
    parent_id uuid,
    kind text DEFAULT 'note'::text NOT NULL,
    cell_id text,
    anchor jsonb,
    body text,
    author text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diagram_comment_pkey PRIMARY KEY (id),
    CONSTRAINT diagram_comment_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'resolved'::text, 'reopened'::text]))),
    CONSTRAINT diagram_comment_body_check CHECK (
        (kind = 'note' AND body IS NOT NULL AND char_length(btrim(body)) BETWEEN 1 AND 2000)
        OR (kind <> 'note' AND body IS NULL)
    ),
    CONSTRAINT diagram_comment_event_parent_check CHECK ((kind = 'note' OR parent_id IS NOT NULL)),
    CONSTRAINT diagram_comment_cell_id_check CHECK ((cell_id IS NULL OR char_length(cell_id) BETWEEN 1 AND 200)),
    CONSTRAINT diagram_comment_diagram_id_fkey FOREIGN KEY (diagram_id) REFERENCES diagram(id) ON DELETE RESTRICT,
    CONSTRAINT diagram_comment_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE RESTRICT,
    CONSTRAINT diagram_comment_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES diagram_comment(id) ON DELETE RESTRICT
);
CREATE INDEX diagram_comment_diagram_idx ON diagram_comment USING btree (diagram_id, created_at);
CREATE INDEX diagram_comment_parent_idx ON diagram_comment USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE INDEX diagram_comment_approval_idx ON diagram_comment USING btree (approval_id) WHERE (approval_id IS NOT NULL);
CREATE TRIGGER diagram_comment_no_delete BEFORE DELETE ON diagram_comment FOR EACH ROW EXECUTE FUNCTION history_append_only();
CREATE TRIGGER diagram_comment_no_truncate BEFORE TRUNCATE ON diagram_comment FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER diagram_comment_no_update BEFORE UPDATE ON diagram_comment FOR EACH ROW EXECUTE FUNCTION history_append_only();

-- Chỉ-thêm như các bảng lịch sử của bản vẽ: ims_app chỉ SELECT + INSERT. Trả lại UPDATE cho chủ
-- sở hữu không superuser vì phép kiểm khoá ngoại `parent_id` (`SELECT … FOR KEY SHARE`) chạy bằng
-- quyền chủ bảng và cần UPDATE; trigger vẫn chặn mọi sửa/xoá.
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_comment FROM ims_app;
REVOKE UPDATE, DELETE, TRUNCATE ON diagram_comment FROM CURRENT_USER;
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'diagram_comment', 'UPDATE') THEN
    GRANT UPDATE ON diagram_comment TO CURRENT_USER;
  END IF;
END $$;

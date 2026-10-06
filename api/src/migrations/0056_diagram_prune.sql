-- Bỏ bản nháp + Xoá hẳn bản vẽ chưa phát hành (Q-23) — chủ: diagrams (AD-3, AD-18).
--
-- Phiên bản, tên phiên bản, bình luận vẫn là bảng chỉ-thêm với `ims_app` (ACL không đổi: không
-- UPDATE/DELETE/TRUNCATE). Đường xoá DUY NHẤT là hàm `diagram_delete_versions` dưới đây
-- (SECURITY DEFINER), và trigger vẫn là lưới thứ hai chặn cả chủ sở hữu: chỉ cho DELETE khi
-- transaction đang ở trong hàm đó, đúng bản vẽ đó, và hàng không phải thứ hồ sơ phải giữ mãi.

-- Bia mộ của "Xoá hẳn": `diagram_history` chỉ-thêm trỏ khoá ngoại RESTRICT vào `diagram`, nên
-- hàng `diagram` không xoá được mà không xoá lịch sử. Hàng ở lại, ẩn khỏi mọi màn; lịch sử và
-- nhật ký vẫn tra được bản vẽ tên gì, ai xoá. Bia mộ luôn đã lưu trữ (giải phóng tên cho anh
-- em) và chưa từng có bản chính thức.
ALTER TABLE diagram
    ADD COLUMN deleted_at timestamp with time zone,
    ADD COLUMN deleted_by text,
    ADD CONSTRAINT diagram_deleted_by_check CHECK (((deleted_at IS NULL) = (deleted_by IS NULL))),
    ADD CONSTRAINT diagram_deleted_state_check CHECK ((deleted_at IS NULL OR (archived_at IS NOT NULL AND official_version_id IS NULL)));

-- Tên phiên bản và bình luận đi theo phiên bản của chúng: xoá phiên bản (chỉ qua hàm dưới, đã
-- qua trigger) kéo theo chúng, thay vì cho xoá trực tiếp từng hàng. Trigger của hai bảng này
-- chỉ nhận lượt xoá dây chuyền đó (phiên bản cha đã không còn).
ALTER TABLE diagram_version_label
    DROP CONSTRAINT diagram_version_label_version_id_fkey,
    ADD CONSTRAINT diagram_version_label_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE CASCADE;
ALTER TABLE diagram_comment
    DROP CONSTRAINT diagram_comment_version_id_fkey,
    ADD CONSTRAINT diagram_comment_version_id_fkey FOREIGN KEY (version_id) REFERENCES diagram_version(id) ON DELETE CASCADE,
    DROP CONSTRAINT diagram_comment_parent_id_fkey,
    ADD CONSTRAINT diagram_comment_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES diagram_comment(id) ON DELETE CASCADE;

-- Cờ `ims.diagram_prune` = '<chế độ>:<id bản vẽ>' chỉ hàm `diagram_delete_versions` đặt (cục bộ
-- transaction) rồi gỡ. Chế độ `drafts`: phiên bản bị xoá không được là bản chính thức, đã đặt
-- tên, hay từng phát hành (dòng `version.published` của `diagram_history` — chỉ-thêm, nên ứng
-- dụng không giả được bằng cách đổi `official_version_id`). Chế độ `purge`: bản vẽ phải là bia
-- mộ và chưa từng phát hành phiên bản nào. UPDATE và TRUNCATE vẫn bị cấm như mọi bảng chỉ-thêm.
CREATE FUNCTION diagram_prune_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  flag text := coalesce(current_setting('ims.diagram_prune', true), '');
  row_json jsonb;
  v uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'Bảng % là append-only (AD-13): cấm %', TG_TABLE_NAME, TG_OP;
  END IF;
  row_json := to_jsonb(OLD);

  IF flag = 'purge:' || (row_json ->> 'diagram_id') THEN
    IF EXISTS (SELECT 1 FROM diagram d
                WHERE d.id = (row_json ->> 'diagram_id')::uuid
                  AND d.deleted_at IS NOT NULL AND d.official_version_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM diagram_history h
                        WHERE h.diagram_id = (row_json ->> 'diagram_id')::uuid AND h.action = 'version.published') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Bản vẽ % chưa xoá hẳn được: còn sống hoặc từng phát hành', row_json ->> 'diagram_id';
  END IF;

  IF flag <> 'drafts:' || (row_json ->> 'diagram_id') THEN
    RAISE EXCEPTION 'Bảng % là append-only (AD-13): cấm %', TG_TABLE_NAME, TG_OP;
  END IF;

  IF TG_TABLE_NAME = 'diagram_version' THEN
    v := (row_json ->> 'id')::uuid;
    IF EXISTS (SELECT 1 FROM diagram d WHERE d.official_version_id = v)
       OR (SELECT l.label FROM diagram_version_label l WHERE l.version_id = v
            ORDER BY l.created_at DESC, l.id DESC LIMIT 1) IS NOT NULL
       OR EXISTS (SELECT 1 FROM diagram_history h
                   WHERE h.diagram_id = OLD.diagram_id AND h.action = 'version.published'
                     AND h.changes ->> 'versionId' = v::text) THEN
      RAISE EXCEPTION 'Phiên bản % là bản chính thức, đã đặt tên hoặc từng phát hành — không xoá', v;
    END IF;
    RETURN OLD;
  END IF;

  -- Tên phiên bản / bình luận: chỉ đi theo lượt xoá dây chuyền khi phiên bản đã qua kiểm ở trên.
  v := (row_json ->> 'version_id')::uuid;
  IF EXISTS (SELECT 1 FROM diagram_version WHERE id = v) THEN
    RAISE EXCEPTION 'Bảng % chỉ xoá theo phiên bản của nó', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER diagram_version_no_delete ON diagram_version;
CREATE TRIGGER diagram_version_no_delete BEFORE DELETE ON diagram_version FOR EACH ROW EXECUTE FUNCTION diagram_prune_guard();
DROP TRIGGER diagram_version_label_no_delete ON diagram_version_label;
CREATE TRIGGER diagram_version_label_no_delete BEFORE DELETE ON diagram_version_label FOR EACH ROW EXECUTE FUNCTION diagram_prune_guard();
DROP TRIGGER diagram_comment_no_delete ON diagram_comment;
CREATE TRIGGER diagram_comment_no_delete BEFORE DELETE ON diagram_comment FOR EACH ROW EXECUTE FUNCTION diagram_prune_guard();

-- Đường xoá duy nhất. SECURITY DEFINER vì `ims_app` không có (và không được có) DELETE trên ba
-- bảng chỉ-thêm; hàm chạy bằng quyền chủ sở hữu nhưng mọi luật giữ hồ sơ nằm ở trigger, nên kể
-- cả `ims_app` bị chiếm cũng chỉ xoá được bản nháp. Nơi gọi phải khoá hàng `diagram` FOR UPDATE
-- trước (lưu / phát hành cùng lúc xếp hàng sau nó).
CREATE FUNCTION diagram_delete_versions(p_diagram uuid, p_versions uuid[], p_mode text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  n integer;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('drafts', 'purge') THEN
    RAISE EXCEPTION 'diagram_delete_versions: chế độ % không hợp lệ', p_mode;
  END IF;
  PERFORM set_config('ims.diagram_prune', p_mode || ':' || p_diagram::text, true);
  DELETE FROM public.diagram_version WHERE diagram_id = p_diagram AND id = ANY (p_versions);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('ims.diagram_prune', '', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION diagram_delete_versions(uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION diagram_delete_versions(uuid, uuid[], text) TO ims_app;

-- 0046/0049 thu DELETE của chính chủ sở hữu trên ba bảng này; hàm trên chạy bằng quyền đó (và
-- lượt xoá dây chuyền chạy bằng quyền chủ bảng con), nên trả lại DELETE cho chủ sở hữu không
-- superuser. Trigger vẫn chặn mọi lượt xoá ngoài hàm; `ims_app` không được gì thêm.
DO $$
BEGIN
  IF NOT has_table_privilege(current_user, 'diagram_version', 'DELETE') THEN
    GRANT DELETE ON diagram_version TO CURRENT_USER;
  END IF;
  IF NOT has_table_privilege(current_user, 'diagram_version_label', 'DELETE') THEN
    GRANT DELETE ON diagram_version_label TO CURRENT_USER;
  END IF;
  IF NOT has_table_privilege(current_user, 'diagram_comment', 'DELETE') THEN
    GRANT DELETE ON diagram_comment TO CURRENT_USER;
  END IF;
END $$;

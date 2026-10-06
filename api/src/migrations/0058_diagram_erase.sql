-- "Xóa vĩnh viễn" bản vẽ đã lưu trữ (Q-23) — chủ: diagrams (AD-3, AD-18).
--
-- Luật "bản chính thức, bản từng phát hành, bản đặt tên giữ mãi" nay chỉ còn áp cho bản vẽ CHƯA
-- lưu trữ. Chế độ mới `erase` của `diagram_delete_versions` xoá được mọi phiên bản của một bản vẽ
-- khi và chỉ khi bản vẽ đó đã là bia mộ (`deleted_at`) và đã được lưu trữ ở một lượt TRƯỚC lượt
-- xoá (`archived_at < deleted_at`): ứng dụng không thể "lưu trữ rồi xoá" một bản đang dùng trong
-- cùng một bước, kể cả khi `ims_app` bị chiếm. Hai chế độ cũ giữ nguyên từng chữ.

CREATE OR REPLACE FUNCTION diagram_prune_guard() RETURNS trigger
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

  IF flag = 'erase:' || (row_json ->> 'diagram_id') THEN
    IF EXISTS (SELECT 1 FROM diagram d
                WHERE d.id = (row_json ->> 'diagram_id')::uuid
                  AND d.deleted_at IS NOT NULL AND d.official_version_id IS NULL
                  AND d.archived_at IS NOT NULL AND d.archived_at < d.deleted_at) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Bản vẽ % chưa xóa vĩnh viễn được: chưa lưu trữ từ trước hoặc chưa là bia mộ', row_json ->> 'diagram_id';
  END IF;

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

CREATE OR REPLACE FUNCTION diagram_delete_versions(p_diagram uuid, p_versions uuid[], p_mode text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  n integer;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('drafts', 'purge', 'erase') THEN
    RAISE EXCEPTION 'diagram_delete_versions: chế độ % không hợp lệ', p_mode;
  END IF;
  PERFORM set_config('ims.diagram_prune', p_mode || ':' || p_diagram::text, true);
  DELETE FROM public.diagram_version WHERE diagram_id = p_diagram AND id = ANY (p_versions);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('ims.diagram_prune', '', true);
  RETURN n;
END $$;

-- CREATE OR REPLACE giữ ACL cũ của hàm; viết lại cho rõ, chạy lại không đổi gì.
REVOKE ALL ON FUNCTION diagram_delete_versions(uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION diagram_delete_versions(uuid, uuid[], text) TO ims_app;

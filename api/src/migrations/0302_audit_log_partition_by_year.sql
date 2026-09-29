-- OLD-DB-03 · `audit_log` chia ngăn theo NĂM (RANGE created_at), có đường lưu trữ.
--
-- Bảng chỉ-thêm giữ vĩnh viễn (NFR-03) nên chỉ to lên. Chia ngăn để năm cũ tách ra được
-- nguyên khối (DETACH + pg_dump, `ops/audit-archive.sh`) mà không phải DELETE một dòng nào —
-- DELETE trên bảng này là thứ cả ACL lẫn trigger cấm. Chia theo năm, không theo tháng: chủ dự
-- án chốt; lượng ghi của IMS nhỏ, ngăn tháng chỉ thêm số bảng mà không thêm lợi.
--
-- ===== RANH GIỚI NĂM TÍNH THEO UTC =====
--
-- Ranh giới ngăn là hằng số ghi vào catalog, không đổi được về sau. `app.timezone` thì đổi
-- được; ranh giới lệch vài giờ so với giờ VN không ảnh hưởng gì tới đọc/ghi, nên chọn thứ
-- không bao giờ đổi.
--
-- ===== VÌ SAO CHÉP SANG BẢNG MỚI, KHÔNG ATTACH BẢNG CŨ =====
--
-- Bảng cũ có khoá chính (id); bảng chia ngăn bắt khoá chính chứa cột chia (id, created_at).
-- ATTACH phải bỏ khoá cũ, dựng khoá mới và đổi tên tám chỉ mục trên bảng cũ, rồi bảng cũ
-- thành một ngăn phủ "từ trước tới nay" không khớp tên năm nào. Chép thì mọi ngăn đều cùng
-- một khuôn do `audit_log_create_year_partition` dựng. Lượng dòng hiện tại nhỏ (dưới trăm
-- nghìn), và migration chạy trước `app.listen` nên không có lượt ghi nào của api chen vào.

LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE;

ALTER TABLE audit_log RENAME TO audit_log_unpartitioned;
-- Giải phóng tên chỉ mục cho bảng cha; bảng cũ bị xoá cuối file.
ALTER TABLE audit_log_unpartitioned DROP CONSTRAINT audit_log_pkey;
DROP INDEX audit_log_created_idx, audit_log_object_idx, audit_log_actor_idx,
  audit_log_actor_trgm, audit_log_object_id_trgm, audit_log_action_idx,
  audit_log_actor_action_at_idx;

CREATE TABLE audit_log (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  actor       text NOT NULL,
  action      text NOT NULL,
  object_type text,
  object_id   text,
  ip          text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Đúng bộ chỉ mục của bảng cũ (0004, 0042, 0046) — màn Nhật ký và bộ đếm dò két dựa vào chúng.
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_object_idx ON audit_log (object_type, object_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor, created_at DESC);
CREATE INDEX audit_log_actor_trgm ON audit_log USING gin (actor gin_trgm_ops);
CREATE INDEX audit_log_object_id_trgm ON audit_log USING gin (object_id gin_trgm_ops);
CREATE INDEX audit_log_action_idx ON audit_log (action);
CREATE INDEX audit_log_actor_action_at_idx ON audit_log (actor, action, created_at DESC);

-- Trigger hàng trên bảng cha được Postgres chép xuống mọi ngăn; trigger TRUNCATE (cấp câu
-- lệnh) thì không, nên mỗi ngăn tự gắn lại ở `audit_log_create_year_partition`.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();

-- Như 0048: ims_app chỉ SELECT + INSERT. ALTER DEFAULT PRIVILEGES vừa cấp thêm UPDATE/DELETE.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ims_app;

/*
 * Khoá kín một ngăn vừa dựng.
 *
 * `ims_app` đi qua bảng cha, và Postgres chỉ kiểm quyền trên bảng cha — nên ngăn không cần
 * cấp gì cho nó. Mà ALTER DEFAULT PRIVILEGES của 0048 lại cấp SELECT/INSERT/UPDATE/DELETE cho
 * mọi bảng mới, kể cả ngăn: không thu lại thì `DELETE FROM audit_log_2026` chạy được bằng role
 * ứng dụng, vòng qua ACL của bảng cha.
 *
 * Tên chỉ mục của ngăn được đặt lại theo khuôn `<ngăn>_<hậu tố của chỉ mục cha>` để EXPLAIN đọc
 * ra được chỉ mục nào đang chạy (tên Postgres tự sinh không mang ý nghĩa gì).
 */
CREATE FUNCTION audit_log_seal_partition(part regclass) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  child record;
BEGIN
  EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', part);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    EXECUTE format('REVOKE ALL ON %s FROM ims_app', part);
  END IF;
  EXECUTE format(
    'CREATE OR REPLACE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON %s '
    || 'FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate()',
    part);

  -- Hai vòng: tên tự sinh của chỉ mục này có thể trùng tên đích của chỉ mục khác
  -- (`audit_log_2026_actor_idx` là tên tự sinh của chỉ mục trigram, và cũng là tên đích của
  -- `audit_log_actor_idx`). Đổi hết sang tên tạm theo oid trước rồi mới đặt tên đích.
  FOR child IN
    SELECT x.indexrelid, ci.relname AS child_name
      FROM pg_index x JOIN pg_class ci ON ci.oid = x.indexrelid
     WHERE x.indrelid = part
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', child.child_name, 'audit_log_tmp_' || child.indexrelid);
  END LOOP;

  FOR child IN
    SELECT ci.relname AS child_name, pi.relname AS parent_name
      FROM pg_index x
      JOIN pg_class ci ON ci.oid = x.indexrelid
      JOIN pg_inherits inh ON inh.inhrelid = x.indexrelid
      JOIN pg_class pi ON pi.oid = inh.inhparent
     WHERE x.indrelid = part
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', child.child_name,
      (SELECT relname FROM pg_class WHERE oid = part)
        || substr(child.parent_name, length('audit_log') + 1));
  END LOOP;
END $$;

/* Dựng ngăn một năm (nếu chưa có) rồi khoá kín nó. */
CREATE FUNCTION audit_log_create_year_partition(y int) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  part text := format('audit_log_%s', y);
BEGIN
  IF to_regclass('public.' || part) IS NOT NULL THEN
    -- Có bảng trùng tên mà không phải ngăn của audit_log (vd ngăn đã tách để lưu trữ mà chưa
    -- đổi tên): dừng, đừng im lặng để dòng năm đó nằm mãi trong DEFAULT.
    IF NOT EXISTS (SELECT 1 FROM pg_inherits
                    WHERE inhrelid = to_regclass('public.' || part)
                      AND inhparent = 'public.audit_log'::regclass) THEN
      RAISE EXCEPTION 'Bảng % đã có nhưng không phải ngăn của audit_log — đổi tên nó trước.', part;
    END IF;
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE TABLE public.%I PARTITION OF public.audit_log FOR VALUES FROM (%L) TO (%L)',
    part,
    make_timestamptz(y, 1, 1, 0, 0, 0, 'UTC'),
    make_timestamptz(y + 1, 1, 1, 0, 0, 0, 'UTC'));
  PERFORM audit_log_seal_partition(('public.' || part)::regclass);
END $$;

/*
 * Việc của lượt sweep (worker, mỗi phút): bảo đảm có ngăn năm nay và năm sau, để ngăn năm mới
 * có sẵn từ trước giao thừa.
 *
 * SECURITY DEFINER vì worker chạy bằng `ims_app`, role không sở hữu `audit_log` nên không tạo
 * được ngăn. Hàm chỉ nhận một ngày và chỉ dựng ngăn tên cố định, không nhận tên bảng hay câu
 * lệnh nào từ người gọi.
 *
 * Dòng lỡ rơi vào DEFAULT (worker tắt qua giao thừa, hoặc giờ ghi lệch) thì Postgres không cho
 * tạo ngăn năm đó. Nên: tách DEFAULT ra, dựng DEFAULT mới và các ngăn còn thiếu, đổ dòng qua
 * bảng cha để chúng tự vào đúng ngăn, đếm lại rồi mới xoá bảng tạm. Không DELETE dòng nào —
 * cả ACL lẫn trigger đều cấm, và đúng thế.
 *
 * Trả về số dòng đã dời. Đường thường ngày (đã đủ ngăn, DEFAULT trống) chỉ đọc catalog và
 * không khoá bảng cha.
 */
CREATE FUNCTION audit_log_ensure_partitions(p_today date DEFAULT (now() AT TIME ZONE 'UTC')::date)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  y int := extract(year FROM p_today)::int;
  moved bigint := 0;
  expected bigint;
  late_year int;
  idx record;
BEGIN
  IF p_today IS NULL OR y NOT BETWEEN 2000 AND 2200 THEN
    RAISE EXCEPTION 'audit_log_ensure_partitions: năm % không hợp lệ', y;
  END IF;

  IF to_regclass('public.audit_log_' || y) IS NOT NULL
     AND to_regclass('public.audit_log_' || (y + 1)) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.audit_log_default) THEN
    RETURN 0;
  END IF;

  -- Hai worker cùng quét thì một người làm, người kia chờ rồi thấy đã xong.
  PERFORM pg_advisory_xact_lock(727002);

  IF EXISTS (SELECT 1 FROM public.audit_log_default) THEN
    ALTER TABLE public.audit_log DETACH PARTITION public.audit_log_default;
    ALTER TABLE public.audit_log_default RENAME TO audit_log_default_draining;
    -- Chỉ mục của ngăn cũ vẫn mang tên `audit_log_default_*`; nhường tên cho DEFAULT mới.
    FOR idx IN
      SELECT x.indexrelid, c.relname FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
       WHERE x.indrelid = 'public.audit_log_default_draining'::regclass
    LOOP
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', idx.relname, 'audit_log_tmp_' || idx.indexrelid);
    END LOOP;
    CREATE TABLE public.audit_log_default PARTITION OF public.audit_log DEFAULT;
    PERFORM audit_log_seal_partition('public.audit_log_default'::regclass);

    FOR late_year IN
      SELECT DISTINCT extract(year FROM created_at AT TIME ZONE 'UTC')::int
        FROM public.audit_log_default_draining
    LOOP
      PERFORM audit_log_create_year_partition(late_year);
    END LOOP;

    SELECT count(*) INTO expected FROM public.audit_log_default_draining;
    INSERT INTO public.audit_log (id, actor, action, object_type, object_id, ip, detail, created_at)
      SELECT id, actor, action, object_type, object_id, ip, detail, created_at
        FROM public.audit_log_default_draining;
    GET DIAGNOSTICS moved = ROW_COUNT;
    IF moved <> expected THEN
      RAISE EXCEPTION 'audit_log: dời % dòng khỏi DEFAULT nhưng đếm được %', moved, expected;
    END IF;
    DROP TABLE public.audit_log_default_draining;
  END IF;

  PERFORM audit_log_create_year_partition(y);
  PERFORM audit_log_create_year_partition(y + 1);
  RETURN moved;
END $$;

-- 0048 cấp EXECUTE mọi hàm mới cho ims_app, và PUBLIC có EXECUTE mặc định. Hai hàm nội bộ dựng
-- và khoá ngăn không được là cửa cho role ứng dụng; chỉ hàm của lượt sweep là cửa.
REVOKE ALL ON FUNCTION audit_log_seal_partition(regclass) FROM PUBLIC, ims_app;
REVOKE ALL ON FUNCTION audit_log_create_year_partition(int) FROM PUBLIC, ims_app;
REVOKE ALL ON FUNCTION audit_log_ensure_partitions(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_log_ensure_partitions(date) TO ims_app;

-- Ngăn cho mọi năm bảng cũ đang có, cùng năm nay và năm sau, rồi DEFAULT.
DO $$
DECLARE
  y int;
BEGIN
  FOR y IN
    SELECT DISTINCT extract(year FROM created_at AT TIME ZONE 'UTC')::int
      FROM audit_log_unpartitioned
    UNION
    SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int
    UNION
    SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int + 1
  LOOP
    PERFORM audit_log_create_year_partition(y);
  END LOOP;
END $$;

CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
SELECT audit_log_seal_partition('audit_log_default'::regclass);

DO $$
DECLARE
  copied bigint;
  expected bigint;
BEGIN
  SELECT count(*) INTO expected FROM audit_log_unpartitioned;
  INSERT INTO audit_log (id, actor, action, object_type, object_id, ip, detail, created_at)
    SELECT id, actor, action, object_type, object_id, ip, detail, created_at
      FROM audit_log_unpartitioned;
  GET DIAGNOSTICS copied = ROW_COUNT;
  IF copied <> expected THEN
    RAISE EXCEPTION 'audit_log: chép % dòng sang bảng chia ngăn nhưng bảng cũ có %', copied, expected;
  END IF;
END $$;

-- Bảng cũ còn trigger chặn DELETE/TRUNCATE nhưng DROP thì không chặn — đúng thứ cần ở đây.
DROP TABLE audit_log_unpartitioned;

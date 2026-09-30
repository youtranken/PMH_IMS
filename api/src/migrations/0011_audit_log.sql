-- audit_log — chủ: audit. Mọi đăng nhập / giải mã / thay đổi, giữ vĩnh viễn (NFR-03). Chia ngăn
-- theo năm (xem audit_log_seal_partition); khoá chính phải chứa cột chia ngăn.
CREATE TABLE audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    object_type text,
    object_id text,
    ip text,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at)
)
PARTITION BY RANGE (created_at);
CREATE INDEX audit_log_action_idx ON audit_log USING btree (action);
CREATE INDEX audit_log_actor_action_at_idx ON audit_log USING btree (actor, action, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log USING btree (actor, created_at DESC);
CREATE INDEX audit_log_actor_trgm ON audit_log USING gin (actor gin_trgm_ops);
CREATE INDEX audit_log_created_idx ON audit_log USING btree (created_at DESC);
CREATE INDEX audit_log_object_id_trgm ON audit_log USING gin (object_id gin_trgm_ops);
CREATE INDEX audit_log_object_idx ON audit_log USING btree (object_type, object_id);
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION append_only_no_truncate();
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Chỉ-thêm (NFR-03): ims_app chỉ SELECT + INSERT. TRUNCATE nằm trong REVOKE vì trigger hàng
-- không bắt được nó.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ims_app;

-- ===== audit_log chia ngăn theo NĂM =====
-- Bảng chỉ-thêm giữ vĩnh viễn (NFR-03) nên chỉ to lên. Chia ngăn để năm cũ tách ra được nguyên
-- khối (DETACH + pg_dump, `ops/audit-archive.sh`) mà không DELETE dòng nào. Theo năm, không theo
-- tháng: lượng ghi nhỏ, ngăn tháng chỉ thêm số bảng. Ranh giới năm tính theo UTC vì ranh giới
-- ngăn là hằng số trong catalog, còn `app.timezone` đổi được.
--
-- Khoá kín một ngăn vừa dựng: `ims_app` đi qua bảng cha và Postgres chỉ kiểm quyền trên bảng
-- cha, nên ngăn không cần cấp gì. Quyền mặc định lại cấp SELECT/INSERT/UPDATE/DELETE cho mọi
-- bảng mới, kể cả ngăn: không thu lại thì `DELETE FROM audit_log_<năm>` chạy được bằng role ứng
-- dụng, vòng qua ACL của bảng cha. Trigger hàng của bảng cha tự chép xuống ngăn; trigger
-- TRUNCATE (cấp câu lệnh) thì không, nên gắn ở đây.
--
-- Tên chỉ mục của ngăn đặt theo khuôn `<ngăn>_<hậu tố của chỉ mục cha>` để EXPLAIN đọc ra được.
CREATE FUNCTION audit_log_seal_partition(part regclass) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Dựng ngăn một năm (nếu chưa có) rồi khoá kín nó.
CREATE FUNCTION audit_log_create_year_partition(y integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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

-- Lượt sweep của worker gọi mỗi phút: bảo đảm có ngăn năm nay và năm sau, để ngăn năm mới có sẵn
-- trước giao thừa.
--
-- SECURITY DEFINER vì worker chạy bằng `ims_app`, không sở hữu `audit_log` nên không tạo được
-- ngăn. Hàm chỉ nhận một ngày và chỉ dựng ngăn tên cố định.
--
-- Dòng lỡ rơi vào DEFAULT (worker tắt qua giao thừa) thì Postgres không cho tạo ngăn năm đó.
-- Nên: tách DEFAULT ra, dựng DEFAULT mới và các ngăn còn thiếu, đổ dòng qua bảng cha để chúng tự
-- vào đúng ngăn, đếm lại rồi mới xoá bảng tạm. Không DELETE dòng nào — ACL lẫn trigger đều cấm.
-- Đường thường ngày (đủ ngăn, DEFAULT trống) chỉ đọc catalog, không khoá bảng cha.
CREATE FUNCTION audit_log_ensure_partitions(p_today date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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
-- Hai hàm nội bộ dựng/khoá ngăn không được là cửa cho role ứng dụng; chỉ hàm của lượt sweep là
-- cửa. PUBLIC có EXECUTE mặc định trên mọi hàm nên phải thu cả PUBLIC.
REVOKE ALL ON FUNCTION audit_log_seal_partition(regclass) FROM PUBLIC, ims_app;
REVOKE ALL ON FUNCTION audit_log_create_year_partition(int) FROM PUBLIC, ims_app;
REVOKE ALL ON FUNCTION audit_log_ensure_partitions(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_log_ensure_partitions(date) TO ims_app;

-- DEFAULT hứng dòng lạc năm; rồi năm nay và năm sau theo đồng hồ lúc chạy. Không ghi cứng năm
-- nào: cài vào năm nào thì ngăn năm đó, lượt sweep lo các năm sau.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
SELECT audit_log_seal_partition('audit_log_default'::regclass);
SELECT audit_log_ensure_partitions();

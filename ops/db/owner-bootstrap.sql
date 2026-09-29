-- DB-03: dựng role CHỦ SỞ HỮU (không superuser) và giao cho nó database + mọi đối tượng.
--
-- Chạy bằng SUPERUSER, trong database của IMS, và chỉ bằng superuser: đây là việc duy nhất còn
-- cần quyền đó. Sau file này service `migrate` chạy bằng role chủ sở hữu, api/worker bằng
-- `ims_app` (0048).
--
-- Đầu vào là hai GUC đặt trong CÙNG phiên trước khi chạy file (`ops/db/initdb-owner.sh` đặt
-- chúng; bài kiểm `api/test/db-owner-role.spec.ts` cũng vậy):
--   ims.owner_role      tên role, production là `ims_owner`
--   ims.owner_password  mật khẩu đăng nhập (MIGRATION_DB_PASSWORD trong .env)
-- Không dùng biến psql `:'x'` để chính file này chạy được qua node-pg trong bài kiểm, tức bài
-- kiểm chạy đúng văn bản mà máy thật chạy.
--
-- Chạy lại bao nhiêu lần cũng được, và PHẢI chạy lại sau mỗi lần nạp dump: dump nạp bằng
-- superuser với `--no-owner` nên mọi bảng lại thuộc về superuser, và migrate sẽ chết ở câu
-- `ALTER TABLE _migrations` đầu tiên.
--
-- Không dùng `REASSIGN OWNED BY <superuser>`: POSTGRES_USER của image là superuser khởi tạo
-- (oid 10), Postgres từ chối REASSIGN khỏi role đó vì nó còn sở hữu catalog hệ thống. Nên đi
-- từng loại đối tượng, rồi kiểm lại ở cuối rằng không sót thứ gì.
DO $bootstrap$
DECLARE
  owner_role text := current_setting('ims.owner_role', true);
  owner_password text := current_setting('ims.owner_password', true);
  owner_oid oid;
  obj record;
  leftover text;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'owner-bootstrap phải chạy bằng superuser (đang là %)', current_user;
  END IF;
  IF coalesce(owner_role, '') = '' THEN
    RAISE EXCEPTION 'thiếu GUC ims.owner_role';
  END IF;
  -- Mật khẩu rỗng = role đăng nhập không cần mật khẩu qua mọi dòng pg_hba không phải trust.
  IF coalesce(owner_password, '') = '' THEN
    RAISE EXCEPTION 'thiếu GUC ims.owner_password (MIGRATION_DB_PASSWORD trong .env)';
  END IF;
  IF owner_role = 'ims_app' THEN
    RAISE EXCEPTION 'role chủ sở hữu không được trùng role ứng dụng ims_app';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role) THEN
    EXECUTE format('CREATE ROLE %I', owner_role);
  END IF;
  -- Liệt kê TƯỜNG MINH mọi thuộc tính: chạy lại trên một role ai đó đã lỡ nâng lên SUPERUSER
  -- hay BYPASSRLS thì nó bị hạ về đúng hình dạng này, không giữ nguyên.
  -- CREATEROLE: `ensureAppRole` phải tạo `ims_app` trên cụm mới và đặt lại mật khẩu của nó
  -- mỗi khi APP_DB_PASSWORD đổi.
  EXECUTE format(
    'ALTER ROLE %I LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L',
    owner_role, owner_password
  );
  owner_oid := owner_role::regrole::oid;

  -- Từ Postgres 16, CREATEROLE chỉ cho sửa role mà mình có ADMIN OPTION. `ims_app` do superuser
  -- tạo (cài cũ, hoặc restore-drill) thì chủ sở hữu không đặt được mật khẩu cho nó. INHERIT và
  -- SET đều FALSE: chủ sở hữu quản trị được `ims_app` nhưng không mang quyền của nó.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    IF pg_has_role('ims_app', owner_oid, 'MEMBER') THEN
      RAISE EXCEPTION 'ims_app đang là thành viên của %: gỡ trước (REVOKE % FROM ims_app)',
        owner_role, owner_role;
    END IF;
    EXECUTE format('GRANT ims_app TO %I WITH ADMIN TRUE, INHERIT FALSE, SET FALSE', owner_role);
  END IF;

  EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), owner_role);

  -- Schema của người dùng. `public` trên Postgres 15+ thuộc `pg_database_owner`, tức đã theo
  -- chủ database ở trên; chỉ cụm cũ mới có `public` thuộc superuser.
  FOR obj IN
    SELECT n.nspname
      FROM pg_namespace n
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND n.nspowner NOT IN (owner_oid, 'pg_database_owner'::regrole)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid
                          AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', obj.nspname, owner_role);
  END LOOP;

  -- Bảng/view. Đổi chủ bảng kéo theo index và sequence gắn vào cột của nó.
  FOR obj IN
    SELECT c.relkind, n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND c.relowner <> owner_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.deptype = 'e')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE obj.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      obj.nspname, obj.relname, owner_role
    );
  END LOOP;

  -- Sequence đứng riêng (không gắn cột nào); loại gắn cột đã đổi theo bảng ở trên, và Postgres
  -- từ chối đổi riêng chúng.
  FOR obj IN
    SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND c.relkind = 'S'
       AND c.relowner <> owner_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.deptype IN ('a', 'i', 'e'))
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', obj.nspname, obj.relname, owner_role);
  END LOOP;

  -- Hàm/thủ tục của IMS (trigger append-only, search_norm…). Hàm của extension giữ nguyên chủ:
  -- chúng thuộc về extension, không thuộc về migration.
  FOR obj IN
    SELECT p.oid::regprocedure AS sig, p.prokind
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND p.proowner <> owner_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                          AND d.deptype = 'e')
  LOOP
    EXECUTE format(
      'ALTER %s %s OWNER TO %I',
      CASE obj.prokind WHEN 'a' THEN 'AGGREGATE' WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      obj.sig, owner_role
    );
  END LOOP;

  -- Kiểu tự tạo (enum, domain, range, composite). Bỏ qua kiểu hàng của bảng và kiểu mảng/
  -- multirange tự sinh: chúng theo chủ của thứ sinh ra chúng.
  FOR obj IN
    SELECT t.oid::regtype AS typ, t.typtype
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_class c ON c.oid = t.typrelid
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND t.typowner <> owner_oid
       AND t.typtype IN ('e', 'd', 'r', 'c')
       AND (t.typrelid = 0 OR c.relkind = 'c')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid
                          AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE obj.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, obj.typ, owner_role);
  END LOOP;

  -- Bảng migration TẠO SAU chỉ có quyền cho ims_app nhờ quyền mặc định, mà quyền mặc định gắn
  -- vào role TẠO bảng. 0048 đặt nó cho role đã chạy 0048 — ở cài cũ là superuser — nên role
  -- chủ sở hữu mới phải có bộ của riêng nó, cùng nội dung với 0048. Trên cụm mới `ims_app`
  -- chưa có ở đây; khi đó 0048 chạy bằng chính role chủ sở hữu và tự đặt.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_app') THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      || 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ims_app', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      || 'GRANT USAGE, SELECT ON SEQUENCES TO ims_app', owner_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
      || 'GRANT EXECUTE ON FUNCTIONS TO ims_app', owner_role);
  END IF;

  -- Phép kiểm khoá ngoại chạy bằng quyền CHỦ bảng con và khoá hàng bảng con (cần UPDATE). Các
  -- bảng lịch sử đã thu UPDATE của chính chủ bảng (0039), vô hại khi chủ là superuser; với chủ
  -- không superuser thì mọi lệnh xoá bảng cha chết với "permission denied for table …_history".
  -- Trả UPDATE cho chủ bảng là đủ: trigger chỉ-thêm vẫn chặn mọi lệnh UPDATE/DELETE.
  FOR obj IN
    SELECT DISTINCT c.conrelid::regclass AS tbl
      FROM pg_constraint c JOIN pg_class k ON k.oid = c.conrelid
     WHERE c.contype = 'f' AND k.relowner = owner_oid
       AND NOT has_table_privilege(owner_oid, c.conrelid, 'UPDATE')
  LOOP
    EXECUTE format('GRANT UPDATE ON %s TO %I', obj.tbl, owner_role);
  END LOOP;

  -- Lưới cuối: sót một đối tượng là migration sau chết giữa chừng với "must be owner", ở đúng
  -- lần nâng cấp. Dừng ngay ở đây rẻ hơn.
  SELECT string_agg(x, ', ') INTO leftover FROM (
    SELECT format('%I.%I', n.nspname, c.relname) AS x
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
       AND c.relowner <> owner_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                          AND d.deptype = 'e')
    UNION ALL
    SELECT p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
       AND p.proowner <> owner_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                          AND d.deptype = 'e')
  ) s;
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'còn đối tượng chưa thuộc %: %', owner_role, leftover;
  END IF;
END
$bootstrap$;

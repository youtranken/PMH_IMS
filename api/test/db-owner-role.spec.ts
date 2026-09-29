import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ensureAppRole, readAppRoleFacts } from '../src/database/app-role';
import { runMigrations } from '../src/database/migration-runner';
import { appDbPassword, appDbUrl, createScratchDb, migrationsDir, testDbUrl, type ScratchDb } from './db';

/**
 * DB-03 — migration chạy bằng role CHỦ SỞ HỮU không phải superuser.
 *
 * Bài chạy đúng văn bản `ops/db/owner-bootstrap.sql` mà máy thật chạy, trên hai hình dạng DB:
 *   - DB TRẮNG: bootstrap trước, rồi cả bộ migration chạy bằng role chủ sở hữu (cài mới).
 *   - DB CŨ: migration chạy bằng superuser như trước DB-03, rồi mới bootstrap (nâng cấp nơi cài
 *     đã có dữ liệu, và cả sau khi nạp dump).
 * Quyền của `ims_app` ở hai DB phải trùng nhau từng ô: `app-role-privileges.spec.ts` kiểm hình
 * dạng đó trên DB migrate bằng superuser, nên trùng nhau nghĩa là mọi điều bài ấy khẳng định
 * vẫn đúng khi migrate bằng role chủ sở hữu.
 *
 * Role chủ sở hữu mang tên ngẫu nhiên và bị xoá ở cuối: role là thứ của cả cụm, và cụm này
 * còn phục vụ stack dev — không được đụng tới `ims_owner` thật của nó.
 */

const TEST_TIMEOUT = 240_000;
const BOOTSTRAP_SQL = readFileSync(
  join(__dirname, '..', '..', 'ops', 'db', 'owner-bootstrap.sql'),
  'utf8',
);

async function runBootstrap(pool: Pool, role: string, password: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `SELECT set_config('ims.owner_role', $1, false), set_config('ims.owner_password', $2, false)`,
      [role, password],
    );
    await client.query(BOOTSTRAP_SQL);
  } finally {
    // Phiên này đang giữ mật khẩu trong GUC; không trả nó về pool cho bài khác dùng lại.
    client.release(true);
  }
}

function urlAs(dbName: string, user: string, password: string): string {
  const url = new URL(testDbUrl(dbName));
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

/**
 * Mọi quyền của `ims_app` trên database, schema, bảng, sequence và hàm của schema public.
 * Hỏi bằng `has_*_privilege` (quyền HIỆU LỰC) chứ không so chuỗi ACL: grantor trong ACL đổi theo
 * chủ sở hữu, còn thứ ứng dụng thấy thì không được đổi.
 */
async function appPrivileges(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ line: string }>(
    `SELECT 'db:' || p || '=' || has_database_privilege('ims_app', current_database(), p) AS line
       FROM unnest(ARRAY['CONNECT', 'CREATE', 'TEMPORARY']) p
     UNION ALL
     SELECT 'schema:' || p || '=' || has_schema_privilege('ims_app', 'public', p)
       FROM unnest(ARRAY['USAGE', 'CREATE']) p
     UNION ALL
     SELECT 'table:' || c.relname || ':' || p || '=' || has_table_privilege('ims_app', c.oid, p)
       FROM pg_class c
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
     UNION ALL
     SELECT 'seq:' || c.relname || ':' || p || '=' || has_sequence_privilege('ims_app', c.oid, p)
       FROM pg_class c CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
     UNION ALL
     SELECT 'fn:' || f.oid::regprocedure::text || '=' || has_function_privilege('ims_app', f.oid, 'EXECUTE')
       FROM pg_proc f WHERE f.pronamespace = 'public'::regnamespace
     ORDER BY 1`,
  );
  return rows.map((r) => r.line);
}

/** Đối tượng của IMS (không tính thành viên extension) KHÔNG thuộc role chủ sở hữu. */
async function notOwnedBy(pool: Pool, role: string): Promise<string[]> {
  const { rows } = await pool.query<{ obj: string }>(
    `SELECT 'rel:' || c.relname AS obj FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relowner <> $1::regrole
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                         AND d.objid = c.oid AND d.deptype = 'e')
     UNION ALL
     SELECT 'fn:' || p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proowner <> $1::regrole
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                         AND d.objid = p.oid AND d.deptype = 'e')
     UNION ALL
     SELECT 'db:' || datname FROM pg_database
      WHERE datname = current_database() AND datdba <> $1::regrole`,
    [role],
  );
  return rows.map((r) => r.obj);
}

describe('DB-03 — role chủ sở hữu không superuser chạy migration', () => {
  const ownerRole = `ims_owner_test_${randomBytes(4).toString('hex')}`;
  const ownerPassword = randomBytes(18).toString('hex');
  const probeRole = `ims_probe_test_${randomBytes(4).toString('hex')}`;
  const allFiles = readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort();

  let admin: Pool;
  let fresh: ScratchDb;
  let legacy: ScratchDb;
  let freshOwner: Pool;
  let legacyOwner: Pool;
  let legacyBefore: string[];

  beforeAll(async () => {
    admin = new Pool({ connectionString: testDbUrl('postgres') });

    // Cài mới: bootstrap trên DB trống, rồi mọi thứ còn lại bằng role chủ sở hữu.
    fresh = await createScratchDb('ims_owner_fresh');
    await runBootstrap(fresh.pool, ownerRole, ownerPassword);
    freshOwner = new Pool({ connectionString: urlAs(fresh.name, ownerRole, ownerPassword) });
    freshOwner.on('error', () => undefined);

    // Nơi cài cũ: đúng luồng trước DB-03 (superuser dựng ims_app + migrate), rồi mới bootstrap.
    legacy = await createScratchDb('ims_owner_legacy');
    await ensureAppRole(legacy.pool, 'ims_app', appDbPassword());
    await runMigrations(legacy.pool, migrationsDir(), { log: () => undefined });
    legacyBefore = await appPrivileges(legacy.pool);
    await runBootstrap(legacy.pool, ownerRole, ownerPassword);
    legacyOwner = new Pool({ connectionString: urlAs(legacy.name, ownerRole, ownerPassword) });
    legacyOwner.on('error', () => undefined);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await freshOwner?.end();
    await legacyOwner?.end();
    await fresh?.drop();
    await legacy?.drop();
    await admin?.query(`DROP ROLE IF EXISTS ${probeRole}`).catch(() => undefined);
    await admin?.query(`DROP ROLE IF EXISTS ${ownerRole}`);
    await admin?.end();
  }, TEST_TIMEOUT);

  it('role chủ sở hữu: đăng nhập được, KHÔNG superuser, chỉ có CREATEROLE', async () => {
    const { rows } = await admin.query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [ownerRole],
    );
    expect(rows[0]).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: true,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
    });
  });

  it(
    'DB TRẮNG: dựng ims_app và chạy TOÀN BỘ migration bằng role chủ sở hữu',
    async () => {
      await ensureAppRole(freshOwner, 'ims_app', appDbPassword());
      const applied = await runMigrations(freshOwner, migrationsDir(), { log: () => undefined });
      expect(applied).toEqual(allFiles);

      const facts = await readAppRoleFacts(freshOwner);
      expect(facts.currentUser).toBe(ownerRole);
      expect(facts.isSuperuser).toBe(false);
      expect(facts.ownsAuditLog).toBe(true);
      expect(await notOwnedBy(freshOwner, ownerRole)).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it('DB TRẮNG: năm extension trusted cài được bằng role không superuser', async () => {
    const { rows } = await freshOwner.query<{ extname: string; owner: string }>(
      `SELECT e.extname, e.extowner::regrole::text AS owner FROM pg_extension e
        WHERE e.extname <> 'plpgsql' ORDER BY 1`,
    );
    expect(rows).toEqual(
      ['btree_gist', 'citext', 'pg_trgm', 'pgcrypto', 'unaccent'].map((extname) => ({
        extname,
        owner: ownerRole,
      })),
    );
  });

  it('quyền của ims_app trùng TỪNG Ô giữa migrate bằng chủ sở hữu và migrate bằng superuser', async () => {
    const freshPrivileges = await appPrivileges(freshOwner);
    // Tiền đề: không có bảng nào thì so sánh rỗng với rỗng là vô nghĩa.
    expect(freshPrivileges.filter((l) => l.startsWith('table:audit_log:'))).toHaveLength(7);
    expect(freshPrivileges).toEqual(legacyBefore);
    expect(freshPrivileges).toContain('table:audit_log:UPDATE=false');
    expect(freshPrivileges).toContain('table:audit_log:INSERT=true');
    expect(freshPrivileges).toContain('table:_migrations:SELECT=false');
  });

  it('DB CŨ: bootstrap giao mọi đối tượng cho chủ sở hữu mà không đổi quyền của ims_app', async () => {
    expect(await notOwnedBy(legacy.pool, ownerRole)).toEqual([]);
    expect(await appPrivileges(legacy.pool)).toEqual(legacyBefore);
  });

  it(
    'DB CŨ: migrate bằng chủ sở hữu sau bootstrap là no-op sạch (các kiểm của runner không cần superuser)',
    async () => {
      await ensureAppRole(legacyOwner, 'ims_app', appDbPassword(), appDbUrl(legacy.name));
      expect(await runMigrations(legacyOwner, migrationsDir(), { log: () => undefined })).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it('DB CŨ: bảng migration SAU tạo bằng chủ sở hữu mới vẫn có quyền cho ims_app', async () => {
    const app = new Pool({ connectionString: appDbUrl(legacy.name) });
    app.on('error', () => undefined);
    try {
      await legacyOwner.query(`CREATE TABLE late_owner_table (id int PRIMARY KEY)`);
      await app.query(`INSERT INTO late_owner_table (id) VALUES (1)`);
      await app.query(`UPDATE late_owner_table SET id = 2`);
      await app.query(`DELETE FROM late_owner_table`);
      await legacyOwner.query(`DROP TABLE late_owner_table`);
    } finally {
      await app.end();
    }
  });

  it('chủ sở hữu thật sự là CHỦ: ALTER được bảng append-only (thứ ims_app không làm được)', async () => {
    const client = await legacyOwner.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE audit_log DISABLE TRIGGER ALL');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('CREATEROLE đủ để tạo và đổi mật khẩu role ứng dụng trên cụm chưa có nó', async () => {
    await ensureAppRole(freshOwner, probeRole, 'mat-khau-mot');
    await ensureAppRole(freshOwner, probeRole, 'mat-khau-hai');
    const { rows } = await admin.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = $1`, [
      probeRole,
    ]);
    expect(rows[0]).toEqual({ rolcanlogin: true });
    await freshOwner.query(`DROP ROLE ${probeRole}`);
  });

  it('chạy lại bootstrap: idempotent, và hạ lại role đã bị ai đó nâng lên SUPERUSER', async () => {
    await admin.query(`ALTER ROLE ${ownerRole} SUPERUSER`);
    await runBootstrap(legacy.pool, ownerRole, ownerPassword);
    const { rows } = await admin.query(`SELECT rolsuper FROM pg_roles WHERE rolname = $1`, [
      ownerRole,
    ]);
    expect(rows[0].rolsuper).toBe(false);
    expect(await appPrivileges(legacy.pool)).toEqual(legacyBefore);
  });

  it('bootstrap từ chối chạy khi không phải superuser, và khi thiếu mật khẩu', async () => {
    await expect(runBootstrap(legacyOwner, ownerRole, ownerPassword)).rejects.toThrow(
      /phải chạy bằng superuser/,
    );
    await expect(runBootstrap(legacy.pool, ownerRole, '')).rejects.toThrow(
      /thiếu GUC ims.owner_password/,
    );
  });

  /*
   * Postgres chạy phép kiểm khoá ngoại (`SELECT … FOR KEY SHARE` trên bảng con) bằng quyền CHỦ
   * bảng con, và khoá hàng cần quyền UPDATE. Bảng lịch sử đã thu UPDATE của chính chủ bảng
   * (0039), nên khi chủ bảng không còn là superuser thì mọi lệnh xoá bảng cha — kể cả của
   * superuser dọn E2E — chết với "permission denied for table …_history".
   */
  it.each([
    ['DB TRẮNG', () => fresh],
    ['DB CŨ', () => legacy],
  ])('%s: xoá dòng bảng cha không vướng quyền của bảng lịch sử con', async (_label, db) => {
    const { rows } = await db().pool.query<{ id: string }>(
      `INSERT INTO approval (kind, state, requester, subject_type, subject_id, reason)
       VALUES ('break_glass', 'pending', 'e2e-fk@qa.test', 'device', gen_random_uuid(), 'fk')
       RETURNING id`,
    );
    await db().pool.query(`DELETE FROM approval WHERE id = $1`, [rows[0].id]);
  });
});

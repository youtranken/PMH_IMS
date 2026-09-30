import { Pool } from 'pg';
import { ensureAppRole } from '../src/database/app-role';
import { runMigrations } from '../src/database/migration-runner';
import { AuditPartitionSweep } from '../src/modules/audit/audit-partition-sweep';
import type { SweepService } from '../src/modules/queue/sweep.service';
import {
  appDbPassword,
  appDbUrl,
  createScratchDb,
  migrationsDir,
  type ScratchDb,
} from './db';

/**
 * OLD-DB-03 — `audit_log` chia ngăn theo NĂM, ngăn mới tự có trước khi năm tới.
 *
 * Hai thứ phải đúng cùng lúc, và mỗi thứ hỏng theo một kiểu im lặng:
 *   1. Ngăn mới sinh ra phải kín y như bảng cha: `ims_app` chỉ thêm và đọc qua bảng cha,
 *      không đụng thẳng được vào ngăn nào (quyền mặc định của `0001_app_role.sql` cấp
 *      UPDATE/DELETE cho mọi bảng mới — kể cả ngăn).
 *   2. Dòng lỡ rơi vào ngăn DEFAULT (worker tắt qua giao thừa) phải được dời sang ngăn đúng
 *      năm, vì Postgres không cho tạo ngăn năm đó khi DEFAULT còn giữ dòng thuộc khoảng ấy.
 */

const TEST_TIMEOUT = 180_000;

async function partitions(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ name: string; bound: string }>(
    `SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'audit_log'::regclass
      ORDER BY c.relname`,
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.bound]));
}

async function rowsIn(pool: Pool, table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ONLY ${table}`);
  return rows[0].n;
}

function sweepOf(scratch: ScratchDb): AuditPartitionSweep {
  const sweep = { register: () => undefined } as unknown as SweepService;
  return new AuditPartitionSweep(scratch.db, sweep);
}

describe('OLD-DB-03 · DB trắng', () => {
  let scratch: ScratchDb;
  let app: Pool;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_part');
    await ensureAppRole(scratch.pool, 'ims_app', appDbPassword());
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    app = new Pool({ connectionString: appDbUrl(scratch.name) });
    app.on('error', () => undefined);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await app?.end();
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('audit_log là bảng chia ngăn RANGE(created_at), có ngăn năm nay, năm sau và DEFAULT', async () => {
    const kind = await scratch.pool.query<{ relkind: string; strategy: string }>(
      `SELECT c.relkind::text AS relkind, p.partstrat::text AS strategy
         FROM pg_class c JOIN pg_partitioned_table p ON p.partrelid = c.oid
        WHERE c.oid = 'audit_log'::regclass`,
    );
    expect(kind.rows).toEqual([{ relkind: 'p', strategy: 'r' }]);

    const year = new Date().getUTCFullYear();
    const parts = await partitions(scratch.pool);
    expect(parts.audit_log_default).toBe('DEFAULT');
    expect(parts[`audit_log_${year}`]).toMatch(new RegExp(`TO \\('${year + 1}-01-01`));
    expect(parts[`audit_log_${year + 1}`]).toMatch(
      new RegExp(`FROM \\('${year + 1}-01-01.*TO \\('${year + 2}-01-01`),
    );
  });

  it('ims_app ghi và đọc qua bảng cha; dòng vào đúng ngăn năm', async () => {
    const year = new Date().getUTCFullYear();
    await app.query(
      `INSERT INTO audit_log (actor, action, object_type) VALUES ('part@test', 'probe.part', 'user')`,
    );
    const { rows } = await app.query<{ tableoid: string }>(
      `SELECT tableoid::regclass::text AS tableoid FROM audit_log WHERE action = 'probe.part'`,
    );
    expect(rows).toEqual([{ tableoid: `audit_log_${year}` }]);
  });

  it('ims_app không đụng thẳng được vào ngăn nào — ACL, không phải trigger', async () => {
    const { rows } = await scratch.pool.query<{ name: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
      `SELECT c.relname AS name,
              has_table_privilege('ims_app', c.oid, 'SELECT') AS sel,
              has_table_privilege('ims_app', c.oid, 'INSERT') AS ins,
              has_table_privilege('ims_app', c.oid, 'UPDATE') AS upd,
              has_table_privilege('ims_app', c.oid, 'DELETE') AS del,
              has_table_privilege('ims_app', c.oid, 'TRUNCATE') AS trunc
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'audit_log'::regclass`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect({ ...r, name: undefined }).toEqual({
        name: undefined,
        sel: false,
        ins: false,
        upd: false,
        del: false,
        trunc: false,
      });
    }
    const year = new Date().getUTCFullYear();
    await expect(app.query(`DELETE FROM audit_log_${year}`)).rejects.toMatchObject({ code: '42501' });
  });

  it('chủ sở hữu cũng không sửa, xoá hay TRUNCATE được một ngăn — trigger vẫn theo xuống', async () => {
    const year = new Date().getUTCFullYear();
    await scratch.pool.query(
      `INSERT INTO audit_log (actor, action) VALUES ('owner@test', 'probe.owner')`,
    );
    for (const sql of [
      `UPDATE audit_log_${year} SET actor = 'x'`,
      `DELETE FROM audit_log_${year}`,
      `TRUNCATE audit_log_${year}`,
      `TRUNCATE audit_log_default`,
      `TRUNCATE audit_log`,
    ]) {
      await expect(scratch.pool.query(sql)).rejects.toMatchObject({ code: 'P0001' });
    }
  });

  it('ims_app gọi được hàm tạo ngăn, nhưng không gọi được hàm nội bộ của nó', async () => {
    await expect(app.query(`SELECT audit_log_ensure_partitions(current_date)`)).resolves.toBeTruthy();
    await expect(app.query(`SELECT audit_log_create_year_partition(2040)`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('hàm tạo ngăn từ chối ngày vô lý thay vì đẻ ngăn cho năm 9999', async () => {
    await expect(app.query(`SELECT audit_log_ensure_partitions('9999-01-01')`)).rejects.toThrow(
      /năm/,
    );
  });

  it('bảng cha có đủ chỉ mục của màn Nhật ký, và ims_app chỉ SELECT + INSERT trên nó', async () => {
    const idx = await scratch.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_log' ORDER BY indexname`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual([
      'audit_log_action_idx',
      'audit_log_actor_action_at_idx',
      'audit_log_actor_idx',
      'audit_log_actor_trgm',
      'audit_log_created_idx',
      'audit_log_object_id_trgm',
      'audit_log_object_idx',
      'audit_log_pkey',
    ]);
    const acl = await scratch.pool.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('ims_app', 'audit_log', 'SELECT') AS sel,
              has_table_privilege('ims_app', 'audit_log', 'INSERT') AS ins,
              has_table_privilege('ims_app', 'audit_log', 'UPDATE') AS upd,
              has_table_privilege('ims_app', 'audit_log', 'DELETE') AS del`,
    );
    expect(acl.rows).toEqual([{ sel: true, ins: true, upd: false, del: false }]);
  });
});

describe('OLD-DB-03 · lượt sweep tạo ngăn năm mới và dời dòng khỏi DEFAULT', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_sweep');
    await ensureAppRole(scratch.pool, 'ims_app', appDbPassword());
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('"hôm nay" là 31/12/2026 thì ngăn 2027 đã có', async () => {
    await sweepOf(scratch).ensure(new Date('2026-12-31T16:59:00Z'));
    expect(Object.keys(await partitions(scratch.pool))).toEqual(
      expect.arrayContaining(['audit_log_2026', 'audit_log_2027']),
    );
  });

  it('"hôm nay" là 31/12/2030 thì tạo 2030 và 2031; gọi lại không đổi gì', async () => {
    const sweep = sweepOf(scratch);
    expect(await sweep.ensure(new Date('2030-12-31T10:00:00Z'))).toBe(0);
    const once = await partitions(scratch.pool);
    expect(once.audit_log_2030).toBeDefined();
    expect(once.audit_log_2031).toBeDefined();
    expect(await sweep.ensure(new Date('2030-12-31T10:00:00Z'))).toBe(0);
    expect(await partitions(scratch.pool)).toEqual(once);
  });

  it('dòng năm 2028 nằm trong DEFAULT: tạo ngăn 2028, dời dòng sang, không mất dòng nào', async () => {
    expect((await partitions(scratch.pool)).audit_log_2028).toBeUndefined();
    await scratch.pool.query(
      `INSERT INTO audit_log (actor, action, created_at) VALUES
         ('late@test', 'probe.late', '2028-03-01T00:00:00Z'),
         ('late@test', 'probe.late', '2028-11-30T23:00:00Z'),
         ('late@test', 'probe.late', '2029-01-05T00:00:00Z')`,
    );
    const ids = await scratch.pool.query<{ id: string }>(
      `SELECT id FROM audit_log WHERE action = 'probe.late' ORDER BY id`,
    );
    expect(await rowsIn(scratch.pool, 'audit_log_default')).toBe(3);
    const total = await rowsIn(scratch.pool, 'audit_log');
    const before = await scratch.pool.query(`SELECT count(*)::int AS n FROM audit_log`);

    expect(await sweepOf(scratch).ensure(new Date('2026-12-31T10:00:00Z'))).toBe(3);

    const parts = await partitions(scratch.pool);
    expect(parts.audit_log_2028).toBeDefined();
    expect(parts.audit_log_2029).toBeDefined();
    expect(parts.audit_log_default).toBe('DEFAULT');
    expect(await rowsIn(scratch.pool, 'audit_log_default')).toBe(0);
    expect(await rowsIn(scratch.pool, 'audit_log_2028')).toBe(2);
    expect(await rowsIn(scratch.pool, 'audit_log_2029')).toBe(1);
    expect(await rowsIn(scratch.pool, 'audit_log')).toBe(total);
    const after = await scratch.pool.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(after.rows).toEqual(before.rows);
    const idsAfter = await scratch.pool.query<{ id: string }>(
      `SELECT id FROM audit_log WHERE action = 'probe.late' ORDER BY id`,
    );
    expect(idsAfter.rows).toEqual(ids.rows);
  });

  it('tách một ngăn như ops/audit-archive.sh rồi gắn lại như RUNBOOK H1: đủ dòng, vẫn kín', async () => {
    const rows2028 = await rowsIn(scratch.pool, 'audit_log_2028');
    await scratch.pool.query(`ALTER TABLE audit_log DETACH PARTITION audit_log_2028`);
    await scratch.pool.query(`ALTER TABLE audit_log_2028 RENAME TO audit_archive_2028`);
    expect((await partitions(scratch.pool)).audit_log_2028).toBeUndefined();
    // Lượt sweep sau khi tách không đụng gì tới bảng đã lưu trữ.
    expect(await sweepOf(scratch).ensure(new Date('2026-12-31T10:00:00Z'))).toBe(0);

    await scratch.pool.query(`ALTER TABLE audit_archive_2028 RENAME TO audit_log_2028`);
    await scratch.pool.query(
      `ALTER TABLE audit_log ATTACH PARTITION audit_log_2028
         FOR VALUES FROM ('2028-01-01 00:00:00+00') TO ('2029-01-01 00:00:00+00')`,
    );
    await scratch.pool.query(`SELECT audit_log_seal_partition('audit_log_2028'::regclass)`);
    expect(await rowsIn(scratch.pool, 'audit_log_2028')).toBe(rows2028);
    const acl = await scratch.pool.query<{ del: boolean }>(
      `SELECT has_table_privilege('ims_app', 'audit_log_2028', 'DELETE') AS del`,
    );
    expect(acl.rows).toEqual([{ del: false }]);
  });

  it('ngăn DEFAULT dựng lại vẫn kín: ims_app không có quyền, trigger vẫn chặn', async () => {
    const acl = await scratch.pool.query<{ upd: boolean; del: boolean; sel: boolean }>(
      `SELECT has_table_privilege('ims_app', 'audit_log_default', 'UPDATE') AS upd,
              has_table_privilege('ims_app', 'audit_log_default', 'DELETE') AS del,
              has_table_privilege('ims_app', 'audit_log_2028', 'SELECT') AS sel`,
    );
    expect(acl.rows).toEqual([{ upd: false, del: false, sel: false }]);
    await expect(scratch.pool.query(`TRUNCATE audit_log_default`)).rejects.toMatchObject({
      code: 'P0001',
    });
    await expect(scratch.pool.query(`DELETE FROM audit_log_2028`)).rejects.toMatchObject({
      code: 'P0001',
    });
  });
});

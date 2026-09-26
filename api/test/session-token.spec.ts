import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { SessionService } from '../src/modules/auth/session.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * SEC-01 — mã phiên (`sessions.id`) KHÔNG được là thứ mở cửa.
 *
 * `sessions.id` được ghi vào `audit_log.object_id` và trả ra ở màn quản trị phiên, nên ai đọc
 * được nhật ký cũng đọc được nó. Cookie vì thế phải mang một token ngẫu nhiên riêng, DB chỉ giữ
 * bản băm SHA-256: có `id` hay có bản băm cũng không dựng lại được cookie.
 */

const TEST_TIMEOUT = 120_000;

describe('SEC-01 · cookie phiên là token ngẫu nhiên, không phải sessions.id', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  let sessions: SessionService;
  let userId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_session_token');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
    // Hai phụ thuộc này chỉ dùng cho dọn phiên cũ; các bài dưới không đi qua đường đó.
    sessions = new SessionService(scratch.db, {} as SystemConfigService, {} as SweepService);
    const rows = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ('sec01@pmh.com.vn', 'SEC 01', 'sa', 'x') RETURNING id`,
    );
    userId = rows.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function create() {
    return scratch.db.transaction((tx) =>
      sessions.createWithin(tx, {
        userId,
        ip: '10.0.0.1',
        userAgent: 'jest',
        absoluteHours: 1,
        totpPending: false,
      }),
    );
  }

  it('createWithin trả về token riêng, khác id và đủ dài (≥ 32 byte ngẫu nhiên)', async () => {
    const created = await create();
    expect(created.token).toEqual(expect.any(String));
    expect(created.token).not.toBe(created.id);
    expect(Buffer.from(created.token, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('tra được phiên bằng token; KHÔNG tra được bằng id', async () => {
    const created = await create();
    await expect(sessions.findByToken(created.token)).resolves.toMatchObject({ id: created.id });
    await expect(sessions.findByToken(created.id)).resolves.toBeNull();
  });

  it('DB không giữ token thô, chỉ giữ bản băm', async () => {
    const created = await create();
    const { rows } = await pool.query<{ token_hash: string }>(
      `SELECT * FROM sessions WHERE id = $1`,
      [created.id],
    );
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(created.token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    // Bản băm cũng không phải chìa: đưa nó vào chỗ cookie thì không ra phiên nào.
    await expect(sessions.findByToken(rows[0].token_hash)).resolves.toBeNull();
  });

  it('token là duy nhất ở tầng DB', async () => {
    const { rows } = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'sessions' AND indexdef ILIKE '%UNIQUE%token_hash%'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('danh sách phiên cho màn quản trị không lộ csrfToken hay bản băm', async () => {
    await create();
    const list = await sessions.listActive(userId);
    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'id', 'ip', 'lastSeenAt', 'userAgent'].sort(),
      );
    }
  });

  it('chuỗi rỗng hoặc rác không làm find ném lỗi', async () => {
    await expect(sessions.findByToken('')).resolves.toBeNull();
    await expect(sessions.findByToken('không-phải-token')).resolves.toBeNull();
  });
});

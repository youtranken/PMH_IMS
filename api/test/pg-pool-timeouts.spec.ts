import type { Pool } from 'pg';
import { createPgPool } from '../src/database/database.module';
import { createScratchDb, testDbUrl, type ScratchDb } from './db';

/**
 * Pool của ứng dụng phải có trần thời gian. Không có thì một transaction treo (lỗi code, chờ I/O
 * ngoài DB) giữ kết nối và khoá vô hạn; mười kết nối kẹt là mọi request sau xếp hàng mãi, trong
 * khi `/health` vẫn trả lời. Kiểm trên kết nối thật vì thứ cần chứng minh là Postgres thực sự cắt.
 */

const TEST_TIMEOUT = 60_000;

describe('pool DB của ứng dụng có trần thời gian', () => {
  let scratch: ScratchDb;
  const pools: Pool[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_pg_pool');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function pool(extra: Record<string, string> = {}): Pool {
    const p = createPgPool({ DATABASE_URL: testDbUrl(scratch.name), ...extra });
    pools.push(p);
    return p;
  }

  it('mặc định: câu lệnh, transaction bỏ ngỏ và chờ khoá đều có trần khác 0', async () => {
    const { rows } = await pool().query<{ s: string; i: string; l: string }>(
      `SELECT current_setting('statement_timeout') AS s,
              current_setting('idle_in_transaction_session_timeout') AS i,
              current_setting('lock_timeout') AS l`,
    );
    expect(rows[0].s).not.toBe('0');
    expect(rows[0].i).not.toBe('0');
    expect(rows[0].l).not.toBe('0');
  }, TEST_TIMEOUT);

  it('câu chạy quá trần bị Postgres huỷ', async () => {
    await expect(pool({ DB_STATEMENT_TIMEOUT_MS: '300' }).query('SELECT pg_sleep(2)')).rejects.toMatchObject({
      code: '57014',
    });
  }, TEST_TIMEOUT);

  it('transaction mở rồi bỏ đó bị cắt, kết nối không bị giữ mãi', async () => {
    const client = await pool({ DB_IDLE_TX_TIMEOUT_MS: '300' }).connect();
    /*
     * KHÔNG tự gắn `client.on('error')` ở đây: pg-pool gỡ listener của nó khi cho mượn kết nối, nên
     * Postgres cắt kết nối đang mượn (FATAL 25P03) mà không ai nghe là Node ném lỗi chưa bắt và
     * sập cả api. Pool phải tự gắn listener cho mọi kết nối — bài này chứng minh điều đó.
     */
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    try {
      await client.query('BEGIN');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await expect(client.query('SELECT 1')).rejects.toThrow();
    } finally {
      client.release(true);
    }
  }, TEST_TIMEOUT);

  it('cấu hình sai thì không khởi động, không âm thầm về 0', () => {
    expect(() => createPgPool({ DATABASE_URL: 'postgres://x', DB_STATEMENT_TIMEOUT_MS: 'abc' })).toThrow(
      /DB_STATEMENT_TIMEOUT_MS/,
    );
  });
});

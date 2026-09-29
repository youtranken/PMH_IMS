import { runMigrations } from '../src/database/migration-runner';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Người dùng gọi "không đăng nhập được" mà tài khoản vẫn "Đang hoạt động": giãn chậm theo CẶP
 * (người dùng, IP) đang chặn họ. SA cần thấy chặn từ IP nào, tới lúc nào, sau mấy lần sai —
 * không chỉ một mốc chung — để biết đó là chính người dùng gõ nhầm hay có ai đang dò từ nơi khác.
 */

const TEST_TIMEOUT = 120_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('LoginFailureService.listForUser — nơi đang chặn / đang đếm sai của một người', () => {
  let scratch: ScratchDb;
  let failures: LoginFailureService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_lockouts_list');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    failures = new LoginFailureService(
      scratch.db,
      new SystemConfigService(scratch.db),
      noopSweep,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let seq = 0;
  async function user(): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, status)
       VALUES ($1, 'Bi chan', 'member', 'x', 'active') RETURNING id`,
      [`chan-${seq}@qa.test`],
    );
    return rows[0].id;
  }

  it(
    'liệt kê từng IP: đang chặn trước (mốc xa nhất đầu), rồi nơi chỉ mới đếm sai; bỏ hàng đã nguội',
    async () => {
      const id = await user();
      await scratch.pool.query(
        `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until) VALUES
           ($1, '198.51.100.7', 5, now() + interval '1 hour'),
           ($1, '203.0.113.9', 8, now() + interval '3 hours'),
           ($1, '192.0.2.44', 2, NULL),
           ($1, '192.0.2.99', 0, now() - interval '1 hour')`,
        [id],
      );
      const rows = await failures.listForUser(id);
      expect(rows.map((row) => [row.ip, row.failedAttempts, row.lockedUntil !== null])).toEqual([
        ['203.0.113.9', 8, true],
        ['198.51.100.7', 5, true],
        ['192.0.2.44', 2, false],
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'mốc chặn đã qua thì không còn là "đang chặn" — trả `lockedUntil: null` nhưng giữ số lần sai',
    async () => {
      const id = await user();
      await scratch.pool.query(
        `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until)
         VALUES ($1, '198.51.100.8', 5, now() - interval '5 minutes')`,
        [id],
      );
      expect(await failures.listForUser(id)).toEqual([
        expect.objectContaining({ ip: '198.51.100.8', failedAttempts: 5, lockedUntil: null }),
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'không lẫn hàng của người khác; người sạch thì mảng rỗng',
    async () => {
      const a = await user();
      const b = await user();
      await scratch.pool.query(
        `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until)
         VALUES ($1, '198.51.100.9', 3, NULL)`,
        [a],
      );
      expect(await failures.listForUser(b)).toEqual([]);
      expect((await failures.listForUser(a)).map((row) => row.ip)).toEqual(['198.51.100.9']);
    },
    TEST_TIMEOUT,
  );
});

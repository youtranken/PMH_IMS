import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AccountsService } from '../src/modules/auth/accounts.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * SA bấm "Mở khóa" là để người đó VÀO LẠI ĐƯỢC NGAY. Nếu bộ đếm gõ sai (theo tài khoản) và bậc
 * giãn chậm theo từng IP còn nguyên thì người dùng vừa được mở vẫn bị chặn thêm vài phút tới
 * vài giờ — SA thấy "Đang hoạt động" trên màn mà người dùng thì không vào được, và không ai giải
 * thích được vì sao.
 */

const TEST_TIMEOUT = 120_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Mở khóa / kích hoạt lại tài khoản xoá sạch bộ đếm sai và giãn chậm', () => {
  let scratch: ScratchDb;
  let accounts: AccountsService;
  const sa = { id: '00000000-0000-0000-0000-000000000001', email: 'sa@qa.test' };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_unlock_clears');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    accounts = new AccountsService(
      db,
      new UsersService(db),
      new SessionService(db, config, noopSweep),
      new PasswordService('p'.repeat(64)),
      audit,
      outbox,
      new LoginFailureService(db, config, noopSweep),
      new ApprovalsApiService(new ApprovalsService(db, audit, new ApprovalKindRegistry())),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let seq = 0;
  async function lockedUser(status: 'locked' | 'disabled'): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, status, failed_attempts, locked_until)
       VALUES ($1, 'Bi khoa', 'member', 'x', $2, 7, now() + interval '2 hours') RETURNING id`,
      [`khoa-${seq}@qa.test`, status],
    );
    const id = rows[0].id;
    await scratch.pool.query(
      `INSERT INTO login_failure (user_id, ip, failed_attempts, locked_until)
       VALUES ($1, '198.51.100.7', 5, now() + interval '1 hour'),
              ($1, '203.0.113.9', 3, NULL)`,
      [id],
    );
    return id;
  }

  async function counters(id: string) {
    const user = await scratch.pool.query<{ failed_attempts: number; locked_until: Date | null }>(
      'SELECT failed_attempts, locked_until FROM users WHERE id = $1',
      [id],
    );
    const perIp = await scratch.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM login_failure WHERE user_id = $1',
      [id],
    );
    return {
      failedAttempts: user.rows[0].failed_attempts,
      lockedUntil: user.rows[0].locked_until,
      perIpRows: Number(perIp.rows[0].n),
    };
  }

  it(
    'Mở khóa (locked → active): cả bộ đếm tài khoản lẫn mọi hàng giãn chậm theo IP về 0',
    async () => {
      const id = await lockedUser('locked');
      await accounts.setStatus(sa, id, 'active');
      expect(await counters(id)).toEqual({ failedAttempts: 0, lockedUntil: null, perIpRows: 0 });
    },
    TEST_TIMEOUT,
  );

  it(
    'Kích hoạt lại (disabled → active) cũng xoá — cùng một cửa "cho vào lại"',
    async () => {
      const id = await lockedUser('disabled');
      await accounts.setStatus(sa, id, 'active');
      expect(await counters(id)).toEqual({ failedAttempts: 0, lockedUntil: null, perIpRows: 0 });
    },
    TEST_TIMEOUT,
  );

  it(
    'Khóa (active → locked) KHÔNG xoá: bộ đếm là bằng chứng đang bị dò mật khẩu',
    async () => {
      const id = await lockedUser('locked');
      await scratch.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [id]);
      await accounts.setStatus(sa, id, 'locked');
      const after = await counters(id);
      expect(after.failedAttempts).toBe(7);
      expect(after.perIpRows).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    'không đụng bộ đếm của người khác',
    async () => {
      const other = await lockedUser('locked');
      const id = await lockedUser('locked');
      await accounts.setStatus(sa, id, 'active');
      expect((await counters(other)).perIpRows).toBe(2);
      expect((await counters(other)).failedAttempts).toBe(7);
    },
    TEST_TIMEOUT,
  );
});

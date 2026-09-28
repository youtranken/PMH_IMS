import { runMigrations } from '../src/database/migration-runner';
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
 * Màn Tài khoản: lọc theo vai / trạng thái / 2 lớp (ADM-044), lý do khi khóa / vô hiệu hóa
 * nằm trong nhật ký (ADM-042), và đổi vai trò sau khi tạo (ADM-037) — không được hạ SA cuối,
 * không tự đổi vai của chính mình, mỗi lần đổi một dòng nhật ký có trước/sau.
 */

const TEST_TIMEOUT = 120_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;
const PAGE = { page: 1, limit: 50 };

describe('Tài khoản · bộ lọc, lý do, đổi vai', () => {
  let scratch: ScratchDb;
  let accounts: AccountsService;
  let users: UsersService;
  const id: Record<string, string> = {};
  let actor: { id: string; email: string };

  async function user(
    email: string,
    role: string,
    status = 'active',
    totp = false,
  ): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, status, totp_enrolled_at)
       VALUES ($1, $2, $3, 'x', $4, CASE WHEN $5::boolean THEN now() ELSE NULL END) RETURNING id`,
      [email, email, role, status, totp],
    );
    return rows[0].id;
  }

  async function lastAudit(objectId: string) {
    const { rows } = await scratch.pool.query<{ action: string; detail: Record<string, unknown> }>(
      `SELECT action, detail FROM audit_log WHERE object_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [objectId],
    );
    return rows[0];
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_accounts_admin_ux');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    users = new UsersService(db);
    accounts = new AccountsService(
      db,
      users,
      new SessionService(db, config, noopSweep),
      new PasswordService('p'.repeat(64)),
      new AuditWriterService(db),
      new OutboxService(db, config, noopSweep),
      new LoginFailureService(db, config, noopSweep),
    );
    // Migration seed có thể đã tạo sẵn SA — dọn để phép đếm trong bài kiểm là của bài kiểm.
    await scratch.pool.query(`DELETE FROM users`);
    id.sa1 = await user('sa1-e2e@qa.test', 'sa', 'active', true);
    id.sa2 = await user('sa2-e2e@qa.test', 'sa', 'active', true);
    id.admin = await user('admin-e2e@qa.test', 'admin', 'active', false);
    id.member = await user('member-e2e@qa.test', 'member', 'active', true);
    id.locked = await user('locked-e2e@qa.test', 'member', 'locked', false);
    actor = { id: id.sa1, email: 'sa1-e2e@qa.test' };
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('lọc theo vai, trạng thái và "chưa cài 2 lớp"', async () => {
    const sas = await accounts.list(PAGE, undefined, undefined, { role: 'sa' });
    expect(sas.items.map((row) => row.email).sort()).toEqual(['sa1-e2e@qa.test', 'sa2-e2e@qa.test']);
    const locked = await accounts.list(PAGE, undefined, undefined, { status: 'locked' });
    expect(locked.items.map((row) => row.email)).toEqual(['locked-e2e@qa.test']);
    const noTotp = await accounts.list(PAGE, undefined, undefined, { totp: 'none' });
    expect(noTotp.items.map((row) => row.email).sort()).toEqual([
      'admin-e2e@qa.test',
      'locked-e2e@qa.test',
    ]);
    expect(noTotp.total).toBe(2);
  });

  it('khóa kèm lý do → lý do nằm trong nhật ký', async () => {
    await accounts.setStatus(actor, id.member, 'locked', 'Nghi bị chiếm E2E');
    const entry = await lastAudit(id.member);
    expect(entry.action).toBe('account.locked');
    expect(entry.detail).toMatchObject({ reason: 'Nghi bị chiếm E2E' });
    await accounts.setStatus(actor, id.member, 'active');
  });

  it('đổi vai: ghi nhật ký trước/sau và có tác dụng ngay', async () => {
    await accounts.setRole(actor, id.admin, 'member');
    expect((await users.findById(id.admin))?.role).toBe('member');
    const entry = await lastAudit(id.admin);
    expect(entry.action).toBe('account.role.changed');
    expect(entry.detail).toMatchObject({ before: 'admin', after: 'member' });
  });

  it('không hạ được khi hệ thống chỉ còn đúng 2 SA hoạt động (NFR-01)', async () => {
    await expect(accounts.setRole(actor, id.sa2, 'admin')).rejects.toMatchObject({
      response: { code: 'LAST_SA' },
    });
    expect((await users.findById(id.sa2))?.role).toBe('sa');
  });

  it('không tự đổi vai của chính mình', async () => {
    await expect(accounts.setRole(actor, id.sa1, 'member')).rejects.toMatchObject({
      response: { code: 'SELF_ROLE_CHANGE' },
    });
  });
});

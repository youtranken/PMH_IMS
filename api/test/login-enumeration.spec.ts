import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuditApiService } from '../src/modules/audit/audit.api';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { AuthService, type LoginContext } from '../src/modules/auth/auth.service';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { TotpService } from '../src/modules/auth/totp.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Đăng nhập không được để lộ email nào có thật, theo cả hai đường:
 *   · thời gian: email không có thật trả lời ngay, không băm Argon2 → nhanh hơn ~100 ms, đếm
 *     được. Đo bằng số lượt `verify` chứ không bấm giờ, để bài không phụ thuộc máy nhanh chậm;
 *   · câu trả lời: "tài khoản bị khoá / vô hiệu" trả TRƯỚC khi kiểm mật khẩu → người lạ biết
 *     email đó có thật. Chỉ người đúng mật khẩu mới được nghe câu đó.
 */

const TEST_TIMEOUT = 120_000;
const PASSWORD = 'Mat-khau-dung-2026!';
const PEPPER = 'p'.repeat(64);
const MASTER_KEY = `1=${'a'.repeat(64)}`;

const noopSweep = { register: () => undefined } as unknown as SweepService;
const ctx: LoginContext = { ip: '198.51.100.77', userAgent: 'jest' };

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (error) {
    const body = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    if (!body?.code) throw error;
    return body.code;
  }
}

describe('Đăng nhập không lộ email có thật', () => {
  let scratch: ScratchDb;
  let auth: AuthService;
  let passwords: PasswordService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_login_enumeration');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    passwords = new PasswordService(PEPPER);
    auth = new AuthService(
      db,
      new UsersService(db),
      new SessionService(db, config, noopSweep),
      passwords,
      new TotpService(),
      new EnvelopeCryptoService(new MasterKeyRing(MASTER_KEY)),
      audit,
      outbox,
      config,
      new KnownDeviceService(db, config, noopSweep),
      new LoginFailureService(db, config, noopSweep),
      new AuditApiService(new SecurityProbeService(db, config, outbox, audit)),
    );
    for (const [email, status] of [
      ['e2e-enum-disabled@qa.test', 'disabled'],
      ['e2e-enum-locked@qa.test', 'locked'],
    ]) {
      await scratch.pool.query(
        `INSERT INTO users (email, full_name, role, password_hash, status, must_change_password)
         VALUES ($1, 'E2E enum', 'member', $2, $3, false)`,
        [email, await passwords.hash(PASSWORD), status],
      );
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('email không có thật vẫn băm mật khẩu đúng một lần, như email có thật', async () => {
    const verify = jest.spyOn(passwords, 'verify');
    try {
      expect(await outcome(auth.login('e2e-khong-co@qa.test', 'gi-cung-duoc', ctx))).toBe('LOGIN_FAILED');
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      verify.mockRestore();
    }
  }, TEST_TIMEOUT);

  it.each([
    ['vô hiệu hoá', 'e2e-enum-disabled@qa.test', 'ACCOUNT_DISABLED'],
    ['khoá tay', 'e2e-enum-locked@qa.test', 'ACCOUNT_LOCKED'],
  ])('tài khoản %s + SAI mật khẩu → câu chung "Email hoặc mật khẩu không đúng"; ĐÚNG mật khẩu → câu riêng', async (_label, email, code) => {
    expect(await outcome(auth.login(email, 'sai-mat-khau', ctx))).toBe('LOGIN_FAILED');
    expect(await outcome(auth.login(email, PASSWORD, ctx))).toBe(code);
  }, TEST_TIMEOUT);
});

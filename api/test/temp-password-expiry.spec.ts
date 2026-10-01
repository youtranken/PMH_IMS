import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuditApiService } from '../src/modules/audit/audit.api';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { AccountsService } from '../src/modules/auth/accounts.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService, type LoginContext } from '../src/modules/auth/auth.service';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService } from '../src/modules/auth/session.service';
import { TotpService } from '../src/modules/auth/totp.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * Q-20 — mật khẩu tạm (tạo tài khoản, SA đặt lại) hết hạn sau `auth.temp_password_hours` giờ.
 * Quá hạn: đăng nhập bị từ chối `TEMP_PASSWORD_EXPIRED` (chỉ khi mật khẩu ĐÚNG — sai thì vẫn là
 * câu chung, không lộ thêm gì), phiên đang chờ đổi mật khẩu bị thu hồi. Tự đặt mật khẩu xong
 * thì không còn hạn nào. Mọi service là bản thật trên DB trắng vừa migrate.
 */

const TEST_TIMEOUT = 120_000;
const PEPPER = 'p'.repeat(64);
const NEW_PASSWORD = 'Mat-khau-moi-E2E-2026!';
const noopSweep = { register: () => undefined } as unknown as SweepService;
const CTX: LoginContext = { ip: '198.51.100.20', userAgent: 'jest' };

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    const r = (await p) as { status?: string };
    return r?.status ?? 'ok';
  } catch (error) {
    const body = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    if (!body?.code) throw error;
    return body.code;
  }
}

describe('Q-20 · mật khẩu tạm có hạn', () => {
  let scratch: ScratchDb;
  let auth: AuthService;
  let accounts: AccountsService;
  let sessions: SessionService;
  let guard: SessionGuard;
  let config: SystemConfigService;
  const sa = { id: '00000000-0000-0000-0000-000000000001', email: 'sa-e2e@qa.test' };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_temp_password_expiry');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    const users = new UsersService(db);
    const passwords = new PasswordService(PEPPER);
    const loginFailures = new LoginFailureService(db, config, noopSweep);
    sessions = new SessionService(db, config, noopSweep);
    auth = new AuthService(
      db,
      users,
      sessions,
      passwords,
      new TotpService(),
      new EnvelopeCryptoService(new MasterKeyRing(`1=${'a'.repeat(64)}`)),
      audit,
      outbox,
      config,
      new KnownDeviceService(db),
      loginFailures,
      new AuditApiService(new SecurityProbeService(db, config, outbox, audit)),
    );
    accounts = new AccountsService(
      db,
      users,
      sessions,
      passwords,
      audit,
      outbox,
      loginFailures,
      new ApprovalsApiService(new ApprovalsService(db, audit, new ApprovalKindRegistry())),
      config,
    );
    guard = new SessionGuard(new Reflector(), sessions, users, config, db, audit);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let seq = 0;
  /** Tài khoản mới qua đúng đường SA tạo, không bắt 2 lớp để đi thẳng tới bước đổi mật khẩu. */
  async function newAccount(): Promise<{ id: string; email: string; temp: string }> {
    seq += 1;
    const email = `e2e-tam-${seq}@qa.test`;
    const { user, temporaryPassword } = await accounts.create(sa, {
      email,
      fullName: `E2E Tam ${seq}`,
      role: 'member',
      totpLoginRequired: false,
    });
    return { id: user.id, email, temp: temporaryPassword };
  }

  async function expiresAt(id: string): Promise<Date | null> {
    const { rows } = await scratch.pool.query<{ temp_password_expires_at: Date | null }>(
      'SELECT temp_password_expires_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0].temp_password_expires_at;
  }

  /** Dời hạn tới `seconds` giây so với bây giờ (âm = đã qua). */
  async function moveExpiry(id: string, seconds: number): Promise<void> {
    await scratch.pool.query(
      `UPDATE users SET temp_password_expires_at = now() + make_interval(secs => $2) WHERE id = $1`,
      [id, seconds],
    );
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>(sql, params);
    return Number(rows[0].n);
  }

  /**
   * Hai request song song cùng mang phiên đã quá hạn: cả hai đọc phiên lúc nó còn sống, rồi cùng
   * vào nhánh thu hồi. Chỉ lượt THẬT SỰ thu hồi được ghi nhật ký. Dàn cảnh tất định: một kết nối
   * giữ khoá hàng phiên, đợi đủ hai lượt đứng chờ khoá, rồi mới nhả.
   */
  async function raceTwo(sessionId: string, run: () => Promise<unknown>) {
    const holder = await scratch.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const both = Promise.allSettled([run(), run()]);
      await waitForLock(scratch.pool, 10_000, 2);
      await holder.query('COMMIT');
      return await both;
    } finally {
      holder.release();
    }
  }

  function context(handler: 'changePassword' | 'me', token: string): ExecutionContext {
    const request = { cookies: { [SESSION_COOKIE]: token } };
    return {
      getHandler: () => (AuthController.prototype as unknown as Record<string, unknown>)[handler],
      getClass: () => AuthController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('seed mặc định 24 giờ', async () => {
    const { rows } = await scratch.pool.query<{ value: unknown }>(
      `SELECT value FROM system_config WHERE key = 'auth.temp_password_hours'`,
    );
    expect(Number(rows[0].value)).toBe(24);
  });

  it(
    'tạo tài khoản → hạn = lúc tạo + 24 giờ; còn hạn thì đăng nhập vào bước đổi mật khẩu',
    async () => {
      const before = Date.now();
      const u = await newAccount();
      const at = await expiresAt(u.id);
      expect(at).not.toBeNull();
      const hours = (at!.getTime() - before) / 3_600_000;
      expect(hours).toBeGreaterThan(23.99);
      expect(hours).toBeLessThan(24.01);

      await moveExpiry(u.id, 30);
      const r = await auth.login(u.email, u.temp, CTX);
      expect(r).toMatchObject({ status: 'authenticated', mustChangePassword: true });
    },
    TEST_TIMEOUT,
  );

  it(
    'quá hạn → TEMP_PASSWORD_EXPIRED, không cấp phiên, một dòng nhật ký, không cộng lượt sai',
    async () => {
      const u = await newAccount();
      await moveExpiry(u.id, -1);
      expect(await outcome(auth.login(u.email, u.temp, CTX))).toBe('TEMP_PASSWORD_EXPIRED');
      expect(await count('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [u.id])).toBe(0);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_log
            WHERE action = 'auth.login.failed' AND object_id = $1
              AND detail->>'reason' = 'temp-password-expired'`,
          [u.id],
        ),
      ).toBe(1);
      const { rows } = await scratch.pool.query<{ failed_attempts: number }>(
        'SELECT failed_attempts FROM users WHERE id = $1',
        [u.id],
      );
      expect(rows[0].failed_attempts).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'quá hạn mà gõ SAI mật khẩu → vẫn là LOGIN_FAILED chung (không lộ trạng thái tài khoản)',
    async () => {
      const u = await newAccount();
      await moveExpiry(u.id, -3600);
      expect(await outcome(auth.login(u.email, 'sai-roi-E2E', CTX))).toBe('LOGIN_FAILED');
    },
    TEST_TIMEOUT,
  );

  it(
    'SA đặt lại → hạn mới tính từ lúc đặt lại, mật khẩu tạm mới đăng nhập được',
    async () => {
      const u = await newAccount();
      await moveExpiry(u.id, -60);
      const before = Date.now();
      const { temporaryPassword } = await accounts.resetPassword(sa, u.id);
      const at = await expiresAt(u.id);
      expect((at!.getTime() - before) / 3_600_000).toBeGreaterThan(23.99);
      expect(await outcome(auth.login(u.email, temporaryPassword, CTX))).toBe('authenticated');
    },
    TEST_TIMEOUT,
  );

  it(
    'tham số đổi thành 2 giờ → mật khẩu tạm cấp sau đó sống 2 giờ',
    async () => {
      await scratch.pool.query(
        `UPDATE system_config SET value = '2' WHERE key = 'auth.temp_password_hours'`,
      );
      config.forget('auth.temp_password_hours');
      try {
        const before = Date.now();
        const u = await newAccount();
        const hours = ((await expiresAt(u.id))!.getTime() - before) / 3_600_000;
        expect(hours).toBeGreaterThan(1.99);
        expect(hours).toBeLessThan(2.01);
      } finally {
        await scratch.pool.query(
          `UPDATE system_config SET value = '24' WHERE key = 'auth.temp_password_hours'`,
        );
        config.forget('auth.temp_password_hours');
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'tự đặt mật khẩu → xoá hạn; mật khẩu thường không bao giờ hết hạn',
    async () => {
      const u = await newAccount();
      const r = await auth.login(u.email, u.temp, CTX);
      if (r.status !== 'authenticated') throw new Error(`không mong ${r.status}`);
      const session = await sessions.findByToken(r.session.token);
      await auth.changePassword(session!, u.temp, NEW_PASSWORD);
      expect(await expiresAt(u.id)).toBeNull();
      expect(await outcome(auth.login(u.email, NEW_PASSWORD, CTX))).toBe('authenticated');
    },
    TEST_TIMEOUT,
  );

  it(
    'phiên đang chờ đổi mật khẩu mà mật khẩu tạm hết hạn → 401 kể cả ở cửa đổi mật khẩu, phiên bị thu hồi',
    async () => {
      const u = await newAccount();
      const r = await auth.login(u.email, u.temp, CTX);
      if (r.status !== 'authenticated') throw new Error(`không mong ${r.status}`);
      const token = r.session.token;
      await expect(guard.canActivate(context('changePassword', token))).resolves.toBe(true);

      await moveExpiry(u.id, -1);
      await expect(guard.canActivate(context('changePassword', token))).rejects.toMatchObject({
        status: 401,
        response: { code: 'SESSION_EXPIRED', reason: 'TEMP_PASSWORD_EXPIRED' },
      });
      const { rows } = await scratch.pool.query<{ revoked_reason: string | null }>(
        'SELECT revoked_reason FROM sessions WHERE id = $1',
        [r.session.id],
      );
      expect(rows[0].revoked_reason).toBe('temp-password-expired');
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.temp_password.expired' AND object_id = $1`,
          [r.session.id],
        ),
      ).toBe(1);
      // Gọi lại: phiên đã chết → 401, không ghi thêm nhật ký.
      await expect(guard.canActivate(context('me', token))).rejects.toMatchObject({ status: 401 });
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.temp_password.expired' AND object_id = $1`,
          [r.session.id],
        ),
      ).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'hai request song song khi mật khẩu tạm vừa hết hạn → cả hai 401, chỉ MỘT dòng nhật ký',
    async () => {
      const u = await newAccount();
      const r = await auth.login(u.email, u.temp, CTX);
      if (r.status !== 'authenticated') throw new Error(`không mong ${r.status}`);
      await moveExpiry(u.id, -1);
      const results = await raceTwo(r.session.id, () =>
        guard.canActivate(context('changePassword', r.session.token)),
      );
      expect(results.map((x) => x.status)).toEqual(['rejected', 'rejected']);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_log WHERE action = 'auth.temp_password.expired' AND object_id = $1`,
          [r.session.id],
        ),
      ).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

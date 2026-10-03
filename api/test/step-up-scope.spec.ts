import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuditApiService } from '../src/modules/audit/audit.api';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { AuthService, type LoginContext } from '../src/modules/auth/auth.service';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { Roles } from '../src/modules/auth/roles.decorator';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService, type SessionRecord } from '../src/modules/auth/session.service';
import { NoStepUp, RequiresStepUp } from '../src/modules/auth/step-up.decorator';
import { StepUpGuard } from '../src/modules/auth/step-up.guard';
import { TotpService } from '../src/modules/auth/totp.service';
import type { AuthedRequest } from '../src/modules/auth/types';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { VaultController } from '../src/modules/vault/vault.controller';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Step-up có phạm vi `vault | diagram` (AD-17, Q-23 "nhập ở đâu tính ở đó") trên DB thật.
 *
 * Canh bốn điều mà bài guard thuần không nói được:
 *   · migration thêm `sessions.diagram_stepped_up_at` và seed `diagram.stepup_grace_minutes`;
 *   · mã 2 lớp lúc ĐĂNG NHẬP (cả nhập mã lẫn cài lần đầu) không đóng dấu phạm vi nào;
 *   · `stepUp` chỉ đóng dấu cột của phạm vi được gửi, audit mang phạm vi;
 *   · bộ đếm gõ sai dùng chung hai phạm vi — xen kẽ hai cửa không né được ngưỡng.
 * Và dựng lại đúng đòn: phiên chỉ có ân hạn két gọi route nội dung sơ đồ (và ngược lại).
 */

const TEST_TIMEOUT = 180_000;
const PASSWORD = 'Mat-khau-dung-2026!';
const PEPPER = 'p'.repeat(64);
const MASTER_KEY = `1=${'c'.repeat(64)}`;
const noopSweep = { register: () => undefined } as unknown as SweepService;
const ctx: LoginContext = { ip: '198.51.100.7', userAgent: 'jest' };

/**
 * Cùng khai báo với route nội dung thật (`diagrams.controller.ts`), nhưng không kéo theo cả module
 * sơ đồ: bài này kiểm guard + `sessions`, không kiểm bản vẽ.
 */
@NoStepUp()
@Controller('api/v1/e2e-diagram-probe')
class DiagramProbeController {
  @Roles('sa', 'admin', 'member')
  @RequiresStepUp('diagram')
  @Get()
  read() {
    return { ok: true };
  }
}

async function codeOf(run: () => Promise<unknown>): Promise<{ code: string; body: Record<string, unknown> }> {
  try {
    await run();
    return { code: 'ok', body: {} };
  } catch (error) {
    const body = (error as { getResponse?: () => Record<string, unknown> }).getResponse?.();
    if (!body?.code) throw error;
    return { code: body.code as string, body };
  }
}

describe('Step-up có phạm vi két / sơ đồ (AD-17)', () => {
  let scratch: ScratchDb;
  let auth: AuthService;
  let sessions: SessionService;
  let users: UsersService;
  let totp: TotpService;
  let envelope: EnvelopeCryptoService;
  let passwords: PasswordService;
  let sessionGuard: SessionGuard;
  let stepUpGuard: StepUpGuard;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_step_up_scope');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    passwords = new PasswordService(PEPPER);
    totp = new TotpService();
    envelope = new EnvelopeCryptoService(new MasterKeyRing(MASTER_KEY));
    users = new UsersService(db);
    sessions = new SessionService(db, config, noopSweep);
    auth = new AuthService(
      db,
      users,
      sessions,
      passwords,
      totp,
      envelope,
      audit,
      outbox,
      config,
      new KnownDeviceService(db, config, noopSweep),
      new LoginFailureService(db, config, noopSweep),
      new AuditApiService(new SecurityProbeService(db, config, outbox, audit)),
    );
    const reflector = new Reflector();
    sessionGuard = new SessionGuard(reflector, sessions, users, config, db, audit);
    stepUpGuard = new StepUpGuard(reflector, config);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function makeUser(enrolled: boolean): Promise<{ id: string; email: string; secret: string }> {
    seq += 1;
    const email = `e2e-stepup-scope-${seq}@qa.test`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, totp_login_required, must_change_password)
       VALUES ($1, 'E2E Step-up Scope', 'sa', $2, true, false) RETURNING id`,
      [email, await passwords.hash(PASSWORD)],
    );
    const id = rows[0].id;
    const secret = totp.generateSecret();
    const sealed = envelope.seal(secret, { table: 'users', recordId: id });
    await scratch.db.transaction((tx) => users.setTotpSecretWithin(tx, id, sealed));
    if (enrolled) {
      await scratch.pool.query('UPDATE users SET totp_enrolled_at = now() WHERE id = $1', [id]);
    }
    return { id, email, secret };
  }

  /** Mã hiện tại, sau khi xoá mốc chống replay — mỗi bước của bài là một lần gõ mã mới. */
  async function freshCode(user: { id: string; secret: string }): Promise<string> {
    await scratch.pool.query('UPDATE users SET totp_last_timestep = NULL WHERE id = $1', [user.id]);
    return totp.generateFor(user.secret, Math.floor(Date.now() / 1000));
  }

  async function marks(sessionId: string) {
    const { rows } = await scratch.pool.query<{
      stepped_up_at: Date | null;
      diagram_stepped_up_at: Date | null;
      stepup_failures: number;
      revoked_at: Date | null;
    }>(
      `SELECT stepped_up_at, diagram_stepped_up_at, stepup_failures, revoked_at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    return rows[0];
  }

  /** Phiên đã đăng nhập đủ (mật khẩu + mã), đi đúng đường thật `login` → `verifyLoginTotp`. */
  async function loggedIn(user: { id: string; email: string; secret: string }) {
    const first = await auth.login(user.email, PASSWORD, ctx);
    expect(first.status).toBe('totp-required');
    const done = await auth.verifyLoginTotp(first.session, await freshCode(user), ctx);
    return done.session;
  }

  function contextFor(token: string, controller: object, handler: string): ExecutionContext {
    const request = { cookies: { [SESSION_COOKIE]: token } } as unknown as AuthedRequest;
    const fn = Object.getOwnPropertyDescriptor((controller as { prototype: object }).prototype, handler)
      ?.value as unknown;
    return {
      getHandler: () => fn,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  async function throughGuards(token: string, controller: object, handler: string) {
    const context = contextFor(token, controller, handler);
    return codeOf(async () => {
      await sessionGuard.canActivate(context);
      await stepUpGuard.canActivate(context);
    });
  }

  it(
    'migration: cột `diagram_stepped_up_at` timestamptz cho phép NULL, khoá ân hạn sơ đồ seed 10',
    async () => {
      const { rows } = await scratch.pool.query<{ data_type: string; is_nullable: string }>(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'sessions' AND column_name = 'diagram_stepped_up_at'`,
      );
      expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
      const seed = await scratch.pool.query<{ value: unknown }>(
        `SELECT value FROM system_config WHERE key = 'diagram.stepup_grace_minutes'`,
      );
      expect(Number(seed.rows[0]?.value)).toBe(10);
    },
    TEST_TIMEOUT,
  );

  it(
    'mã 2 lớp lúc đăng nhập KHÔNG mở phạm vi nào: cả hai mốc đều NULL',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      const row = await marks(session.id);
      expect(row.stepped_up_at).toBeNull();
      expect(row.diagram_stepped_up_at).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'cài 2 lớp lần đầu trong luồng đăng nhập cũng không mở phạm vi nào',
    async () => {
      const user = await makeUser(false);
      const first = await auth.login(user.email, PASSWORD, ctx);
      expect(first.status).toBe('totp-enroll-required');
      const done = await auth.confirmTotpEnrollment(
        first.session,
        await freshCode(user),
        ctx,
      );
      const row = await marks(done.session.id);
      expect(row.stepped_up_at).toBeNull();
      expect(row.diagram_stepped_up_at).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'vừa đăng nhập có mã: route két và route sơ đồ đều đòi mã, mỗi bên nói đúng phạm vi',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      const vault = await throughGuards(session.token, VaultController, 'reveal');
      expect(vault.code).toBe('STEPUP_REQUIRED');
      expect(vault.body).toMatchObject({ scope: 'vault', graceMinutes: 10 });
      const diagram = await throughGuards(session.token, DiagramProbeController, 'read');
      expect(diagram.code).toBe('STEPUP_REQUIRED');
      expect(diagram.body).toMatchObject({ scope: 'diagram', graceMinutes: 10 });
    },
    TEST_TIMEOUT,
  );

  it(
    'ĐÒN: nhập mã cho két → két mở, nhưng route nội dung sơ đồ vẫn 401 scope diagram',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      await auth.stepUp(await sessions.find(session.id) as SessionRecord, await freshCode(user), 'vault');

      const row = await marks(session.id);
      expect(row.stepped_up_at).not.toBeNull();
      expect(row.diagram_stepped_up_at).toBeNull();

      expect((await throughGuards(session.token, VaultController, 'reveal')).code).toBe('ok');
      const diagram = await throughGuards(session.token, DiagramProbeController, 'read');
      expect(diagram.code).toBe('STEPUP_REQUIRED');
      expect(diagram.body).toMatchObject({ scope: 'diagram' });
    },
    TEST_TIMEOUT,
  );

  it(
    'ĐÒN ngược: nhập mã cho sơ đồ → sơ đồ mở, két vẫn 401 scope vault',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      await auth.stepUp(await sessions.find(session.id) as SessionRecord, await freshCode(user), 'diagram');

      const row = await marks(session.id);
      expect(row.diagram_stepped_up_at).not.toBeNull();
      expect(row.stepped_up_at).toBeNull();

      expect((await throughGuards(session.token, DiagramProbeController, 'read')).code).toBe('ok');
      const vault = await throughGuards(session.token, VaultController, 'reveal');
      expect(vault.code).toBe('STEPUP_REQUIRED');
      expect(vault.body).toMatchObject({ scope: 'vault' });
    },
    TEST_TIMEOUT,
  );

  it(
    'audit step-up (đúng và sai) ghi kèm phạm vi',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      const record = (await sessions.find(session.id)) as SessionRecord;
      await auth.stepUp(record, await freshCode(user), 'diagram');
      expect((await codeOf(() => auth.stepUp(record, '000000', 'vault'))).code).toMatch(/TOTP_/);

      const { rows } = await scratch.pool.query<{ action: string; detail: Record<string, unknown> }>(
        `SELECT action, detail FROM audit_log
          WHERE object_id = $1 AND action LIKE 'auth.stepup.%' ORDER BY created_at`,
        [session.id],
      );
      expect(rows.map((r) => [r.action, r.detail?.scope])).toEqual([
        ['auth.stepup.ok', 'diagram'],
        ['auth.stepup.failed', 'vault'],
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'bộ đếm gõ sai dùng CHUNG: xen kẽ cửa két và cửa sơ đồ vẫn thu hồi phiên đúng ngưỡng',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      const record = (await sessions.find(session.id)) as SessionRecord;
      const max = Number(
        (
          await scratch.pool.query<{ value: unknown }>(
            `SELECT value FROM system_config WHERE key = 'secret.stepup_max_failures'`,
          )
        ).rows[0].value,
      );
      const outcomes: string[] = [];
      for (let i = 1; i <= max; i += 1) {
        const scope = i % 2 === 0 ? 'diagram' : 'vault';
        outcomes.push((await codeOf(() => auth.stepUp(record, '000000', scope))).code);
      }
      expect(outcomes.slice(0, -1).every((c) => c === 'TOTP_INVALID')).toBe(true);
      expect(outcomes[outcomes.length - 1]).toBe('SESSION_REVOKED');
      expect((await marks(session.id)).revoked_at).not.toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'gõ đúng ở một phạm vi xoá bộ đếm chung (đếm LIÊN TIẾP, không tích luỹ)',
    async () => {
      const user = await makeUser(true);
      const session = await loggedIn(user);
      const record = (await sessions.find(session.id)) as SessionRecord;
      await codeOf(() => auth.stepUp(record, '000000', 'vault'));
      await codeOf(() => auth.stepUp(record, '000000', 'vault'));
      expect((await marks(session.id)).stepup_failures).toBe(2);
      await auth.stepUp(record, await freshCode(user), 'diagram');
      expect((await marks(session.id)).stepup_failures).toBe(0);
    },
    TEST_TIMEOUT,
  );
});

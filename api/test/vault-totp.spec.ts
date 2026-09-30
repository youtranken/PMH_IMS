import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import type { AuditApiService } from '../src/modules/audit/audit.api';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SESSION_COOKIE } from '../src/modules/auth/cookie';
import { SessionGuard } from '../src/modules/auth/session.guard';
import { SessionService } from '../src/modules/auth/session.service';
import { StepUpGuard } from '../src/modules/auth/step-up.guard';
import type { AuthedRequest } from '../src/modules/auth/types';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import type { BreakGlassService } from '../src/modules/vault/break-glass.service';
import { VaultController } from '../src/modules/vault/vault.controller';
import { VaultService } from '../src/modules/vault/vault.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ngăn "Mã 2 lớp" (Q-18) trên Postgres thật, qua `VaultController` + guard THẬT.
 *
 * Canh ba điều mà bài hàm thuần không nói được:
 *   · CHECK ở tầng DB nhận `totp` (whitelist ba tầng, tầng DB là tầng hay bị quên);
 *   · khóa bí mật không lọt vào ciphertext dạng rõ, nhật ký hay thân lỗi;
 *   · MỘT lần gõ mã 6 số đủ cho cả cất mật khẩu lẫn cất mã 2 lớp trong
 *     `secret.stepup_grace_minutes` — đọc từ `sessions` và `system_config` thật.
 */

const TEST_TIMEOUT = 180_000;
const MASTER_KEY = `1=${'b'.repeat(64)}`;
const SEED = 'JBSWY3DPEHPK3PXP';
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Két: ngăn Mã 2 lớp (Q-18)', () => {
  let scratch: ScratchDb;
  let vault: VaultService;
  let controller: VaultController;
  let sessions: SessionService;
  let sessionGuard: SessionGuard;
  let stepUpGuard: StepUpGuard;
  let userId: string;
  const sa = 'e2e-totp-sa@qa.test';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_vault_totp');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const config = new SystemConfigService(scratch.db);
    const audit = new AuditWriterService(scratch.db);
    const owners = {
      assertExists: () => Promise.resolve(),
      assertUsableWithin: () => Promise.resolve(),
    } as unknown as OwnerExistsRegistry;
    vault = new VaultService(
      scratch.db,
      new EnvelopeCryptoService(new MasterKeyRing(MASTER_KEY)),
      audit,
      owners,
    );
    controller = new VaultController(
      vault,
      config,
      {} as BreakGlassService,
      audit,
      { noteSecurityFailure: () => Promise.resolve() } as unknown as AuditApiService,
    );
    sessions = new SessionService(scratch.db, config, noopSweep);
    const reflector = new Reflector();
    sessionGuard = new SessionGuard(reflector, sessions, new UsersService(scratch.db), config);
    stepUpGuard = new StepUpGuard(reflector, config);
    const rows = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ($1, 'E2E TOTP SA', 'sa', 'x', false) RETURNING id`,
      [sa],
    );
    userId = rows.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const saReq = () =>
    ({ user: { email: sa, role: 'sa', sessionId: randomUUID(), steppedUpAt: new Date() } }) as AuthedRequest;

  function body(kind: 'password' | 'totp', value: string, extra: Record<string, string> = {}) {
    return {
      ownerType: 'device' as const,
      ownerId: randomUUID(),
      kind,
      label: `E2E ${kind} ${randomUUID().slice(0, 6)}`,
      value,
      ...extra,
    };
  }

  async function errorOf(run: () => Promise<unknown>): Promise<{ code?: string; text: string }> {
    try {
      await run();
    } catch (error) {
      const response = (error as { getResponse?: () => { code?: string } }).getResponse?.();
      return { code: response?.code, text: JSON.stringify(response ?? String(error)) };
    }
    return { code: 'ok', text: '' };
  }

  it(
    'CHECK tầng DB nhận `totp`, vẫn từ chối loại bịa',
    async () => {
      const insert = (kind: string) =>
        scratch.pool.query(
          `INSERT INTO secret (owner_type, owner_id, kind, label, value_ct, value_iv, value_tag,
             dek_wrapped, key_version, created_by)
           VALUES ('device', gen_random_uuid(), $1, 'E2E check', '\\x00', '\\x00', '\\x00', '\\x00', 1, 'x')`,
          [kind],
        );
      await expect(insert('totp')).resolves.toBeDefined();
      await expect(insert('bogus')).rejects.toThrow(/secret_kind_check/);
    },
    TEST_TIMEOUT,
  );

  it(
    'cất khóa trần: lưu URI chuẩn hóa (đã mã hóa), nhật ký không mang khóa',
    async () => {
      const input = body('totp', 'jbsw y3dp ehpk 3pxp', { username: 'admin@pmh' });
      const meta = await controller.create(input, saReq());
      expect(meta.kind).toBe('totp');

      const raw = await scratch.pool.query<{ ct: Buffer }>(
        'SELECT value_ct AS ct FROM secret WHERE id = $1',
        [meta.id],
      );
      expect(raw.rows[0].ct.toString('latin1')).not.toContain(SEED);

      const opened = await vault.reveal(sa, meta.id);
      expect(opened.value).toBe(
        `otpauth://totp/${encodeURIComponent(input.label)}:admin%40pmh?secret=${SEED}` +
          `&issuer=${encodeURIComponent(input.label)}&algorithm=SHA1&digits=6&period=30`,
      );

      const logged = await scratch.pool.query<{ detail: unknown }>(
        'SELECT detail FROM audit_log WHERE object_id = $1',
        [meta.id],
      );
      expect(logged.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(logged.rows)).not.toContain(SEED);
    },
    TEST_TIMEOUT,
  );

  it(
    'khóa hỏng: 400 TOTP_SEED_INVALID, không ghi hàng nào, thân lỗi không nhắc lại khóa',
    async () => {
      const bad = 'JBSWY3DPEHPK3PX0';
      const input = body('totp', bad);
      const error = await errorOf(() => controller.create(input, saReq()));
      expect(error.code).toBe('TOTP_SEED_INVALID');
      expect(error.text).not.toContain(bad);
      const rows = await scratch.pool.query('SELECT 1 FROM secret WHERE owner_id = $1', [
        input.ownerId,
      ]);
      expect(rows.rowCount).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'ghi chú chứa chính khóa (khác dạng viết) bị từ chối như mật khẩu',
    async () => {
      const input = body('totp', SEED, { note: 'khoa jbsw-y3dp-ehpk-3pxp' });
      const error = await errorOf(() => controller.create(input, saReq()));
      expect(error.code).toBe('NOTE_CONTAINS_SECRET');
      expect(error.text).not.toContain(SEED);
    },
    TEST_TIMEOUT,
  );

  it(
    'mở két: trả QR + mã hiện tại, nhật ký "đã xem" không mang khóa hay ảnh',
    async () => {
      const meta = await controller.create(body('totp', SEED), saReq());
      const opened = (await controller.reveal({ id: meta.id }, saReq())) as unknown as {
        value: string;
        revealSeconds: number;
        totp: { qrDataUrl: string; codes: string[]; secondsLeft: number; secret: string };
      };
      expect(opened.totp.secret).toBe(SEED);
      expect(opened.totp.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(opened.totp.codes[0]).toMatch(/^\d{6}$/);
      expect(opened.totp.secondsLeft).toBeGreaterThan(0);
      expect(opened.totp.secondsLeft).toBeLessThanOrEqual(30);

      const logged = await scratch.pool.query<{ detail: unknown }>(
        `SELECT detail FROM audit_log WHERE object_id = $1 AND action = 'vault.secret.revealed'`,
        [meta.id],
      );
      expect(logged.rowCount).toBe(1);
      const text = JSON.stringify(logged.rows);
      expect(text).not.toContain(SEED);
      expect(text).not.toContain('data:image');
    },
    TEST_TIMEOUT,
  );

  it(
    'mở ngăn mật khẩu: không có khối `totp`',
    async () => {
      const meta = await controller.create(body('password', 'Cisco#Core2026!'), saReq());
      const opened = (await controller.reveal({ id: meta.id }, saReq())) as unknown as {
        totp?: unknown;
      };
      expect(opened.totp).toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'đổi giá trị ngăn mã 2 lớp: chuẩn hóa theo tên ngăn đang có; khóa hỏng bị từ chối',
    async () => {
      const meta = await controller.create(body('totp', SEED), saReq());
      const next = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
      await controller.rotate({ id: meta.id }, { value: next }, saReq());
      const opened = await vault.reveal(sa, meta.id);
      expect(opened.value).toContain(`secret=${next}&issuer=${encodeURIComponent(meta.label)}`);

      const error = await errorOf(() =>
        controller.rotate({ id: meta.id }, { value: 'otpauth://hotp/x?secret=' + next }, saReq()),
      );
      expect(error.code).toBe('TOTP_SEED_INVALID');
    },
    TEST_TIMEOUT,
  );

  describe('một lần step-up cho mọi thao tác két trong grace (Q-18)', () => {
    let token: string;
    let sessionId: string;

    beforeAll(async () => {
      const created = await scratch.db.transaction(async (tx) => {
        const session = await sessions.createWithin(tx, {
          userId,
          ip: '10.0.0.9',
          userAgent: 'jest',
          absoluteHours: 12,
          totpPending: false,
        });
        await sessions.markSteppedUpWithin(tx, session.id);
        return session;
      });
      token = created.token;
      sessionId = created.id;
    }, TEST_TIMEOUT);

    /** Chạy đúng chuỗi guard của một request thật rồi gọi `create` với `req.user` guard dựng. */
    async function createThroughGuards(input: ReturnType<typeof body>): Promise<string> {
      const request = { cookies: { [SESSION_COOKIE]: token } } as unknown as AuthedRequest;
      const handler = Object.getOwnPropertyDescriptor(VaultController.prototype, 'create')
        ?.value as unknown;
      const context = {
        getHandler: () => handler,
        getClass: () => VaultController,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      const outcome = await errorOf(async () => {
        await sessionGuard.canActivate(context);
        await stepUpGuard.canActivate(context);
        await controller.create(input, request);
      });
      return outcome.code ?? outcome.text;
    }

    it(
      'cất mật khẩu rồi cất mã 2 lớp: cả hai qua, không bị đòi mã lần hai',
      async () => {
        const before = await sessions.find(sessionId);
        expect(await createThroughGuards(body('password', 'Cisco#Core2026!'))).toBe('ok');
        expect(await createThroughGuards(body('totp', SEED))).toBe('ok');
        // Ghi vào két không được làm mới hay xoá mốc step-up: grace đếm từ lần gõ mã, không trượt.
        const after = await sessions.find(sessionId);
        expect(after?.steppedUpAt?.getTime()).toBe(before?.steppedUpAt?.getTime());
      },
      TEST_TIMEOUT,
    );

    it(
      'quá `secret.stepup_grace_minutes` thì cất mã 2 lớp bị đòi mã',
      async () => {
        await scratch.pool.query(
          `UPDATE sessions SET stepped_up_at = now() - make_interval(mins => (
             SELECT (value #>> '{}')::int + 1 FROM system_config WHERE key = 'secret.stepup_grace_minutes'
           )) WHERE id = $1`,
          [sessionId],
        );
        expect(await createThroughGuards(body('totp', SEED))).toBe('STEPUP_REQUIRED');
      },
      TEST_TIMEOUT,
    );
  });
});

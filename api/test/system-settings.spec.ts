import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { StepUpGuard } from '../src/modules/auth/step-up.guard';
import type { AuthedRequest } from '../src/modules/auth/types';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { SystemSettingsController } from '../src/modules/config-sys/system-settings.controller';
import { SystemSettingsService } from '../src/modules/config-sys/system-settings.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Màn Tham số hệ thống (Q-14) trên DB thật — dựng lại đúng các đòn:
 *   · Admin/Thành viên gọi PATCH → 403 (qua `RolesGuard` THẬT, đọc decorator THẬT của controller);
 *   · SA mà không vừa xác thực lại → bị đòi mã (`StepUpGuard` THẬT, ân hạn đọc từ DB);
 *   · khoá ngoài danh sách khai báo (kể cả khoá có thật trong bảng) → 400, bảng không đổi;
 *   · giá trị ngoài khoảng / chuỗi rỗng → 400, không khoá nào trong lượt bị đổi.
 */

const TEST_TIMEOUT = 180_000;

function contextFor(handler: keyof SystemSettingsController, user: Partial<AuthedRequest['user']>) {
  const request = { user } as AuthedRequest;
  // Lấy hàm qua descriptor: chính hàm đó là khoá mà `Reflector` đọc metadata của decorator.
  const fn = Object.getOwnPropertyDescriptor(SystemSettingsController.prototype, handler)?.value as unknown;
  return {
    getHandler: () => fn,
    getClass: () => SystemSettingsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'ok';
  } catch (error) {
    const body = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    return body?.code ?? String(error);
  }
}

describe('Tham số hệ thống — /admin/settings', () => {
  let scratch: ScratchDb;
  let settings: SystemSettingsService;
  let roles: RolesGuard;
  let stepUp: StepUpGuard;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_system_settings');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const config = new SystemConfigService(scratch.db);
    settings = new SystemSettingsService(scratch.db, config, new AuditWriterService(scratch.db));
    const reflector = new Reflector();
    roles = new RolesGuard(reflector);
    stepUp = new StepUpGuard(reflector, config);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const valueOf = async (key: string) =>
    (await scratch.pool.query<{ value: unknown }>('SELECT value FROM system_config WHERE key = $1', [key]))
      .rows[0]?.value;

  it(
    'TẤN CÔNG: Quản trị và Thành viên gọi PATCH → 403; đọc cũng chỉ SA',
    async () => {
      for (const role of ['admin', 'member'] as const) {
        expect(await codeOf(() => roles.canActivate(contextFor('update', { role })))).toBe('FORBIDDEN_ROLE');
        expect(await codeOf(() => roles.canActivate(contextFor('list', { role })))).toBe('FORBIDDEN_ROLE');
      }
      expect(roles.canActivate(contextFor('update', { role: 'sa' }))).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'TẤN CÔNG: SA chưa xác thực lại (hoặc quá ân hạn) → bị đòi mã; vừa xác thực thì qua',
    async () => {
      const stale = new Date(Date.now() - 60 * 60_000);
      expect(
        await codeOf(stepUp.canActivate(contextFor('update', { role: 'sa', steppedUpAt: null }))),
      ).toBe('STEPUP_REQUIRED');
      expect(
        await codeOf(stepUp.canActivate(contextFor('update', { role: 'sa', steppedUpAt: stale }))),
      ).toBe('STEPUP_REQUIRED');
      expect(
        await stepUp.canActivate(contextFor('update', { role: 'sa', steppedUpAt: new Date() })),
      ).toBe(true);
      // Đọc không đòi step-up.
      expect(await stepUp.canActivate(contextFor('list', { role: 'sa', steppedUpAt: null }))).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'khoá ngoài danh sách khai báo → 400, kể cả khoá CÓ THẬT trong bảng',
    async () => {
      const before = await valueOf('app.timezone');
      expect(
        await codeOf(settings.update('sa@qa.test', [{ key: 'app.timezone', value: 'UTC' }])),
      ).toBe('SETTING_NOT_EDITABLE');
      expect(
        await codeOf(settings.update('sa@qa.test', [{ key: 'khong.co.that', value: 1 }])),
      ).toBe('SETTING_NOT_EDITABLE');
      expect(await valueOf('app.timezone')).toEqual(before);
    },
    TEST_TIMEOUT,
  );

  it(
    'giá trị ngoài khoảng / chuỗi rỗng → 400 và KHÔNG khoá nào trong lượt bị đổi',
    async () => {
      const idleBefore = await valueOf('session.idle_minutes');
      expect(
        await codeOf(
          settings.update('sa@qa.test', [
            { key: 'session.idle_minutes', value: 45 },
            { key: 'session.absolute_hours', value: 0 },
          ]),
        ),
      ).toBe('SETTING_OUT_OF_RANGE');
      expect(
        await codeOf(settings.update('sa@qa.test', [{ key: 'login.rate_limit_per_ip', value: '' }])),
      ).toBe('SETTING_OUT_OF_RANGE');
      expect(
        await codeOf(settings.update('sa@qa.test', [{ key: 'expiry.critical_days', value: 60 }])),
      ).toBe('SETTING_OUT_OF_RANGE');
      expect(await valueOf('session.idle_minutes')).toEqual(idleBefore);
    },
    TEST_TIMEOUT,
  );

  it(
    'sửa hợp lệ: ghi giá trị đã chuẩn hoá, "sửa lần cuối bởi/lúc", mỗi khoá một dòng nhật ký có trước/sau',
    async () => {
      const list = await settings.update('sa@qa.test', [
        { key: 'auth.support_contact', value: '  Gọi IT: 1234  ' },
        { key: 'software.auto_retire_grace_days', value: '45' },
        { key: 'login.account_backoff_minutes', value: '5, 15,30' },
      ]);
      expect(await valueOf('auth.support_contact')).toBe('Gọi IT: 1234');
      expect(await valueOf('software.auto_retire_grace_days')).toBe(45);
      expect(await valueOf('login.account_backoff_minutes')).toBe('5,15,30');
      const grace = list.find((s) => s.key === 'software.auto_retire_grace_days')!;
      expect(grace.updatedBy).toBe('sa@qa.test');
      expect(grace.updatedAt).not.toBeNull();
      expect(grace.defaultValue).toBe(30);

      const audit = await scratch.pool.query<{ object_id: string; detail: { before: unknown; after: unknown } }>(
        `SELECT object_id, detail FROM audit_log WHERE action = 'system_config.updated' ORDER BY object_id`,
      );
      expect(audit.rows.map((r) => r.object_id)).toEqual([
        'auth.support_contact',
        'login.account_backoff_minutes',
        'software.auto_retire_grace_days',
      ]);
      expect(audit.rows[2].detail).toMatchObject({ after: 45 });
    },
    TEST_TIMEOUT,
  );

  it(
    'danh sách đọc chỉ có khoá khai báo — khoá kỹ thuật không lộ ra',
    async () => {
      const keys = (await settings.list()).map((s) => s.key);
      expect(keys).toContain('auth.support_contact');
      expect(keys).toContain('software.auto_retire_grace_days');
      expect(keys).not.toContain('mail.from_address');
      expect(keys).not.toContain('app.timezone');
    },
    TEST_TIMEOUT,
  );
});

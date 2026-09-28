import { runMigrations } from '../src/database/migration-runner';
import { AuditObjectLabelRegistry } from '../src/common/audit-object-labels.registry';
import { AuditQueryService } from '../src/modules/audit/audit-query.service';
import { SessionAuditLabeler } from '../src/modules/auth/session-audit-labeler';
import { SessionService } from '../src/modules/auth/session.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DeviceAuditLabeler } from '../src/modules/devices/device-audit-labeler';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersAuditLabeler } from '../src/modules/users/users-audit-labeler';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Màn Nhật ký gọi tên đối tượng qua module chủ sở hữu (AD-2) — chạy SQL thật của từng người gọi
 * tên trên DB thật, qua đúng `AuditQueryService.listAudit` mà controller gọi.
 */

const TEST_TIMEOUT = 180_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Nhãn đối tượng trên màn Nhật ký', () => {
  let scratch: ScratchDb;
  let service: AuditQueryService;
  let userId: string;
  let deviceId: string;
  let sessionId: string;
  const ghostDevice = '44444444-4444-4444-8444-444444444444';
  const natRule = '55555555-5555-4555-8555-555555555555';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_audit_labels');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const usersService = new UsersService(db);
    const usersApi = new UsersApiService(usersService);
    const registry = new AuditObjectLabelRegistry();
    new UsersAuditLabeler(registry, usersService).onModuleInit();
    new DeviceAuditLabeler(db, registry).onModuleInit();
    new SessionAuditLabeler(registry, new SessionService(db, config, noopSweep), usersApi).onModuleInit();
    service = new AuditQueryService(db, usersApi, config, registry);

    const pool = scratch.pool;
    userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash)
         VALUES ('nguyen.a@pmh.com.vn', 'Nguyễn A', 'member', 'x') RETURNING id`,
      )
    ).rows[0].id;
    const typeId = (
      await pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Loại nhãn nhật ký') RETURNING id`)
    ).rows[0].id;
    deviceId = (
      await pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id) VALUES ('PC-KT-01', 'Máy kế toán', $1) RETURNING id`,
        [typeId],
      )
    ).rows[0].id;
    sessionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO sessions (user_id, csrf_token, token_hash, absolute_expires_at)
         VALUES ($1, 'c', 'h', now() + interval '1 hour') RETURNING id`,
        [userId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO audit_log (actor, action, object_type, object_id) VALUES
         ('sa@pmh.com.vn', 'account.created', 'user', $1),
         ('sa@pmh.com.vn', 'device.updated', 'device', $2),
         ('sa@pmh.com.vn', 'session.killed', 'session', $3),
         ('sa@pmh.com.vn', 'device.updated', 'device', $4),
         ('sa@pmh.com.vn', 'nat.created', 'nat_rule', $5),
         ('sa@pmh.com.vn', 'auth.login.failed', 'user', 'khong-phai-uuid')`,
      [userId, deviceId, sessionId, ghostDevice, natRule],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function rowFor(objectId: string) {
    const page = await service.listAudit({ page: 1, pageSize: 50 });
    return page.items.find((r) => r.objectId === objectId)!;
  }

  it(
    'tài khoản → email + link tới màn Tài khoản lọc sẵn',
    async () => {
      const row = await rowFor(userId);
      expect(row.objectLabel).toBe('nguyen.a@pmh.com.vn');
      expect(row.objectPath).toBe('/admin/accounts?q=nguyen.a%40pmh.com.vn');
    },
    TEST_TIMEOUT,
  );

  it(
    'thiết bị → "mã — tên" + link hồ sơ',
    async () => {
      const row = await rowFor(deviceId);
      expect(row.objectLabel).toBe('PC-KT-01 — Máy kế toán');
      expect(row.objectPath).toBe(`/devices/${deviceId}`);
    },
    TEST_TIMEOUT,
  );

  it(
    'phiên → email người sở hữu phiên',
    async () => {
      expect((await rowFor(sessionId)).objectLabel).toBe('nguyen.a@pmh.com.vn');
    },
    TEST_TIMEOUT,
  );

  it(
    'hồ sơ đã xoá, loại chưa ai gọi tên, id không phải UUID → null (màn giữ loại + UUID), không lỗi',
    async () => {
      expect((await rowFor(ghostDevice)).objectLabel).toBeNull();
      expect((await rowFor(natRule)).objectLabel).toBeNull();
      const odd = await rowFor('khong-phai-uuid');
      expect(odd.objectLabel).toBeNull();
      expect(odd.objectPath).toBeNull();
    },
    TEST_TIMEOUT,
  );
});

import { runMigrations } from '../src/database/migration-runner';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-13 — phần mềm Hết hạn quá số ngày ân hạn thì hệ thống tự Thanh lý và gỡ ghế license;
 * người dùng khôi phục được bằng Sửa hồ sơ (đặt lại trạng thái + ngày hết hạn mới).
 */

const TEST_TIMEOUT = 120_000;
const TODAY = '2026-10-01';
const GRACE = 30;

describe('Q-13 · tự thanh lý phần mềm hết hạn quá ân hạn', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_retire');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    software = new SoftwareService(
      scratch.db,
      { lists: () => Promise.resolve({ vendors: [] }) } as unknown as CatalogApiService,
      audit,
      {} as ExpiryApiService,
      config,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  // Bảng lịch sử cấm TRUNCATE/DELETE (AD-13), nên mỗi bài dùng bộ mã riêng thay vì dọn bảng.
  let round = 0;
  const sfx = () => `-R${round}`;

  beforeEach(async () => {
    round += 1;
    await scratch.pool.query(
      `UPDATE software SET status = 'retired' WHERE status <> 'retired'`,
    );
    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, license_model, end_date, status) VALUES
         ('SW-QUA-31' || $1, 'Hết hạn 31 ngày', 'license', 'subscription', '2026-08-31', 'expired_ok'),
         ('SW-QUA-30' || $1, 'Hết hạn 30 ngày', 'license', 'subscription', '2026-09-01', 'expired_ok'),
         ('SW-CHUA-QUET' || $1, 'Qua hạn lâu, chưa từng quét', 'ssl', 'subscription', '2026-07-01', 'active'),
         ('SW-CON-HAN' || $1, 'Còn hạn', 'ssl', 'subscription', '2027-01-01', 'active'),
         ('SW-VINH-VIEN' || $1, 'Vĩnh viễn', 'license', 'perpetual', NULL, 'active')`,
      [sfx()],
    );
  });

  async function statusOf(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ status: string }>(
      'SELECT status FROM software WHERE code = $1',
      [code + sfx()],
    );
    return rows[0].status;
  }

  async function idOf(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      'SELECT id FROM software WHERE code = $1',
      [code + sfx()],
    );
    return rows[0].id;
  }

  /** Gán một ghế của `code` cho một máy mới, trả id máy. */
  async function assignSeat(code: string): Promise<string> {
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Loai Q13 ' || gen_random_uuid()) RETURNING id`,
    );
    const device = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id)
       VALUES ('PC-Q13-' || substr(gen_random_uuid()::text, 1, 8), 'May Q13', $1) RETURNING id`,
      [type.rows[0].id],
    );
    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by) VALUES ($1, $2, 'sa')`,
      [await idOf(code), device.rows[0].id],
    );
    return device.rows[0].id;
  }

  it(
    'hết hạn QUÁ 30 ngày → Thanh lý; đúng 30 ngày thì chưa; còn hạn và vĩnh viễn không đụng',
    async () => {
      const result = await software.syncExpiryStatuses(TODAY, GRACE);
      expect(result.retired).toBe(2);
      expect(await statusOf('SW-QUA-31')).toBe('retired');
      expect(await statusOf('SW-CHUA-QUET')).toBe('retired');
      expect(await statusOf('SW-QUA-30')).toBe('expired_ok');
      expect(await statusOf('SW-CON-HAN')).toBe('active');
      expect(await statusOf('SW-VINH-VIEN')).toBe('active');
    },
    TEST_TIMEOUT,
  );

  it(
    'tự thanh lý thì gỡ mọi ghế đang gán, mỗi ghế một dòng lịch sử của `system`',
    async () => {
      await assignSeat('SW-QUA-31');
      await assignSeat('SW-QUA-31');
      await software.syncExpiryStatuses(TODAY, GRACE);

      const open = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM license_assignment WHERE software_id = $1 AND released_at IS NULL`,
        [await idOf('SW-QUA-31')],
      );
      expect(open.rows[0].n).toBe(0);
      const history = await scratch.pool.query<{ action: string; actor: string; n: number }>(
        `SELECT action, actor, count(*)::int AS n FROM software_history
          WHERE software_id = $1 GROUP BY action, actor ORDER BY action`,
        [await idOf('SW-QUA-31')],
      );
      expect(history.rows).toEqual([
        { action: 'auto-retired', actor: 'system', n: 1 },
        { action: 'license-released', actor: 'system', n: 2 },
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    'ân hạn = 0 là TẮT tự thanh lý (vẫn chuyển Hết hạn như cũ)',
    async () => {
      const result = await software.syncExpiryStatuses(TODAY, 0);
      expect(result.retired).toBe(0);
      expect(await statusOf('SW-QUA-31')).toBe('expired_ok');
      expect(await statusOf('SW-CHUA-QUET')).toBe('expired_ok');
    },
    TEST_TIMEOUT,
  );

  it(
    'hồ sơ đã tự thanh lý rời khỏi màn Sắp hết hạn / dashboard',
    async () => {
      await software.syncExpiryStatuses(TODAY, GRACE);
      const due = await software.findExpiringBetween('2020-01-01', '2027-12-31');
      expect(due.map((s) => s.code)).toEqual([`SW-QUA-30${sfx()}`, `SW-CON-HAN${sfx()}`]);
    },
    TEST_TIMEOUT,
  );

  it(
    'khôi phục bằng Sửa hồ sơ: trạng thái Đang dùng + ngày hết hạn mới → về Đang dùng, không bị thanh lý lại',
    async () => {
      await software.syncExpiryStatuses(TODAY, GRACE);
      const id = await idOf('SW-QUA-31');
      const restored = await software.update('sa', id, { status: 'active', endDate: '2027-08-31' });
      expect(restored.status).toBe('active');
      await software.syncExpiryStatuses(TODAY, GRACE);
      expect(await statusOf('SW-QUA-31')).toBe('active');
    },
    TEST_TIMEOUT,
  );

  it(
    'khôi phục mà hạn vẫn ở quá khứ thì bị từ chối — nếu không, lượt quét sau lại thanh lý nó',
    async () => {
      await software.syncExpiryStatuses(TODAY, GRACE);
      const id = await idOf('SW-QUA-31');
      await expect(
        software.update('sa', id, { status: 'active', endDate: '2026-09-15' }),
      ).rejects.toMatchObject({ response: { code: 'RESTORE_NEEDS_FUTURE_END' } });
      expect(await statusOf('SW-QUA-31')).toBe('retired');
    },
    TEST_TIMEOUT,
  );
});

import { runMigrations } from '../src/database/migration-runner';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DOM-03 (QUYET-DINH Q-03) — hệ thống tự chuyển trạng thái phần mềm theo hạn.
 *
 * Qua ngày hết hạn mà chưa gia hạn → Hết hạn (thôi nhắc). Có ngày mới → Đang dùng. Thanh lý là
 * quyết định của người, lượt tự chuyển không bao giờ đụng tới.
 */

const TEST_TIMEOUT = 120_000;

describe('DOM-03 · phần mềm tự chuyển trạng thái theo hạn', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_expire');
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
    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, license_model, end_date, status) VALUES
         ('SW-QUA-HAN', 'Qua hạn', 'ssl', 'subscription', '2026-09-30', 'active'),
         ('SW-HOM-NAY', 'Hết hạn hôm nay', 'ssl', 'subscription', '2026-10-01', 'active'),
         ('SW-DA-GIA-HAN', 'Đã gia hạn', 'ssl', 'subscription', '2027-10-01', 'expired_ok'),
         ('SW-THANH-LY', 'Thanh lý', 'ssl', 'subscription', '2020-01-01', 'retired'),
         ('SW-VINH-VIEN', 'Vĩnh viễn', 'license', 'perpetual', NULL, 'active')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function statusOf(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ status: string }>(
      `SELECT status FROM software WHERE code = $1`,
      [code],
    );
    return rows[0].status;
  }

  it('đồng bộ theo ngày hôm nay: qua hạn → Hết hạn, có hạn mới → Đang dùng, Thanh lý giữ nguyên', async () => {
    await expect(software.syncExpiryStatuses('2026-10-01')).resolves.toEqual({
      expired: 1,
      reactivated: 1,
    });
    expect(await statusOf('SW-QUA-HAN')).toBe('expired_ok');
    expect(await statusOf('SW-HOM-NAY')).toBe('active');
    expect(await statusOf('SW-DA-GIA-HAN')).toBe('active');
    expect(await statusOf('SW-THANH-LY')).toBe('retired');
    expect(await statusOf('SW-VINH-VIEN')).toBe('active');
  });

  it('mỗi lượt chuyển để lại một dòng lịch sử của `system`', async () => {
    const { rows } = await scratch.pool.query<{ action: string; actor: string }>(
      `SELECT h.action, h.actor FROM software_history h JOIN software s ON s.id = h.software_id
        WHERE s.code IN ('SW-QUA-HAN', 'SW-DA-GIA-HAN') ORDER BY s.code`,
    );
    expect(rows).toEqual([
      { action: 'reactivated', actor: 'system' },
      { action: 'expired', actor: 'system' },
    ]);
  });

  it('chạy lại cùng ngày thì không đổi gì', async () => {
    await expect(software.syncExpiryStatuses('2026-10-01')).resolves.toEqual({
      expired: 0,
      reactivated: 0,
    });
  });

  it('hồ sơ Hết hạn vẫn lấy cho màn hình (mục quá hạn phải thấy được), Thanh lý thì không', async () => {
    const due = await software.findExpiringBetween('2020-01-01', '2026-12-31');
    expect(due.map((s) => [s.code, s.status])).toEqual([
      ['SW-QUA-HAN', 'expired_ok'],
      ['SW-HOM-NAY', 'active'],
    ]);
  });
});

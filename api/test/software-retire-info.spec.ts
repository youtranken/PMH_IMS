import { runMigrations } from '../src/database/migration-runner';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-13 — thứ màn hình cần để NÓI RÕ vòng đời Hết hạn → Thanh lý:
 *  · `autoRetireOn`: ngày lượt quét sẽ tự thanh lý, tính từ số ngày ân hạn trong
 *    `system_config` (AD-11) — màn không được tự giả định 30;
 *  · `retirement`: hồ sơ Thanh lý lúc nào, tự động hay do ai.
 */

const TEST_TIMEOUT = 120_000;
const TODAY = '2026-10-01';

describe('Q-13 · thông tin thanh lý cho màn hình', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let grace = 30;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_retire_info');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: (name: string) =>
        name === 'softwareAutoRetireGraceDays'
          ? Promise.resolve(grace)
          : Promise.reject(new Error(`khoá lạ ${name}`)),
    } as unknown as SystemConfigService;
    software = new SoftwareService(
      scratch.db,
      { lists: () => Promise.resolve({ vendors: [] }) } as unknown as CatalogApiService,
      { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService,
      {} as ExpiryApiService,
      config,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let round = 0;
  beforeEach(() => {
    round += 1;
    grace = 30;
  });

  async function insert(code: string, endDate: string | null, status: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model, end_date, status)
       VALUES ($1, 'PM', 'ssl', 'subscription', $2, $3) RETURNING id`,
      [`${code}-R${round}`, endDate, status],
    );
    return rows[0].id;
  }

  it(
    'Hết hạn → autoRetireOn theo số ngày ân hạn ĐANG cấu hình; Đang dùng thì null',
    async () => {
      const expired = await insert('SW-HET', '2026-09-01', 'expired_ok');
      const active = await insert('SW-CON', '2099-01-01', 'active');

      expect((await software.detail(expired)).autoRetireOn).toBe('2026-10-02');
      expect((await software.detail(active)).autoRetireOn).toBeNull();

      grace = 10;
      const [shown] = await software.present([await software.findOne(expired)]);
      expect(shown.autoRetireOn).toBe('2026-09-12');

      grace = 0;
      expect((await software.detail(expired)).autoRetireOn).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'tự thanh lý → retirement { auto: true, by: system }',
    async () => {
      const id = await insert('SW-TU', '2026-08-01', 'expired_ok');
      await software.syncExpiryStatuses(TODAY, 30);

      const shown = await software.detail(id);
      expect(shown.status).toBe('retired');
      expect(shown.retirement).toMatchObject({ auto: true, by: 'system' });
      expect(shown.retirement?.at).toBeInstanceOf(Date);
    },
    TEST_TIMEOUT,
  );

  it(
    'người thanh lý → retirement ghi đúng người; khôi phục rồi thì null; thanh lý lại lấy lần mới nhất',
    async () => {
      const id = await insert('SW-TAY', '2099-01-01', 'active');
      await software.update('a@pmh.com.vn', id, { status: 'retired' });
      expect((await software.detail(id)).retirement).toMatchObject({
        auto: false,
        by: 'a@pmh.com.vn',
      });

      await software.update('b@pmh.com.vn', id, { status: 'active' });
      expect((await software.detail(id)).retirement).toBeNull();

      await software.update('c@pmh.com.vn', id, { status: 'retired' });
      expect((await software.detail(id)).retirement).toMatchObject({ by: 'c@pmh.com.vn' });
    },
    TEST_TIMEOUT,
  );

  it(
    'hồ sơ Thanh lý không có dòng lịch sử (nhập thẳng) → retirement null, không vỡ',
    async () => {
      const id = await insert('SW-NHAP', '2020-01-01', 'retired');
      expect((await software.detail(id)).retirement).toBeNull();
    },
    TEST_TIMEOUT,
  );
});

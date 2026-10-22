import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/** FM-21 — mã kế tiếp theo hồ sơ thêm GẦN NHẤT, nhảy qua mã đã có; phần mềm theo loại của màn. */
const TEST_TIMEOUT = 120_000;

describe('Gợi ý mã kế tiếp', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let software: SoftwareService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_next_code');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, catalog, audit, {} as DeviceRetirementRegistry, new DeviceSearchRegistry());
    software = new SoftwareService(scratch.db, catalog, audit, {} as ExpiryApiService, new SystemConfigService(scratch.db));
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    for (const [code, at] of [['PC-E2E-009', '2026-01-01'], ['PC-E2E-011', '2026-01-02'], ['PC-E2E-010', '2026-01-03']]) {
      await scratch.pool.query(`INSERT INTO device (code, name, device_type_id, created_at) VALUES ($1, $2, $3, $4)`, [code, code, type.rows[0].id, at]);
    }
    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, license_model, created_at) VALUES
         ('LIC-E2E-04', 'A', 'license', 'perpetual', '2026-01-01'),
         ('SSL-E2E-7', 'B', 'ssl', 'subscription', '2026-02-01')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('thiết bị: sau máy thêm gần nhất (010), nhảy qua 011 đã có → 012', async () => {
    expect(await devices.suggestCode()).toBe('PC-E2E-012');
  });

  it('phần mềm: theo loại của màn — License gợi ý theo license, không theo SSL thêm sau', async () => {
    expect(await software.suggestCode(['license'])).toBe('LIC-E2E-05');
    expect(await software.suggestCode(['ssl', 'domain'])).toBe('SSL-E2E-8');
  });
});

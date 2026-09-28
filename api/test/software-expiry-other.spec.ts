import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { SoftwareExpiryRegistrar } from '../src/modules/software/software-expiry-sources';
import { SoftwareService } from '../src/modules/software/software.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-14 (28/09/2026): hồ sơ phần mềm loại "Khác" có ngày hết hạn là NGUỒN HẠN như mọi loại khác —
 * trước đây lượt quét vẫn chuyển nó Hết hạn/Thanh lý mà màn Sắp hết hạn và mail không hề nhắc.
 */

const TEST_TIMEOUT = 120_000;

describe('Nguồn hạn phần mềm · loại "Khác"', () => {
  let scratch: ScratchDb;
  let registry: ExpirySourceRegistry;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_exp_other');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, license_model, end_date, status) VALUES
       ('ZOOM-E2E-KHAC', 'Zoom E2E', 'other', 'subscription', '2030-01-15', 'active'),
       ('ZOOM-E2E-KHAC-TL', 'Zoom E2E bỏ', 'other', 'subscription', '2030-01-16', 'retired'),
       ('SSL-E2E-KHAC', 'SSL E2E', 'ssl', 'subscription', '2030-01-17', 'active')`,
    );
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: () => Promise.resolve(30),
    } as unknown as SystemConfigService;
    const software = new SoftwareService(
      scratch.db,
      { lists: () => Promise.resolve({ vendors: [] }) } as unknown as CatalogApiService,
      {} as AuditWriterService,
      {} as ExpiryApiService,
      config,
    );
    registry = new ExpirySourceRegistry();
    new SoftwareExpiryRegistrar(registry, software).onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('đăng ký nguồn "other" với nhãn "Khác", gia hạn được', () => {
    expect(registry.list()).toContainEqual({ kind: 'other', label: 'Khác', canRenew: true });
  });

  it('nguồn "other" trả đúng hồ sơ Khác còn sống trong cửa sổ, không lẫn loại khác', async () => {
    const items = await registry.find('other')!.findExpiring('2030-01-01', '2030-01-31');
    expect(items.map((item) => item.code)).toEqual(['ZOOM-E2E-KHAC']);
    expect(items[0]).toMatchObject({ kind: 'other', end: '2030-01-15' });
  });
});

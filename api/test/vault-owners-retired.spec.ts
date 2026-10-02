import { runMigrations } from '../src/database/migration-runner';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SoftwareApiService } from '../src/modules/software/software.api';
import { SoftwareService } from '../src/modules/software/software.service';
import { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * Trang tổng két và khối "Két lâu không đổi" của bảng điều khiển đọc chung `VaultOwnersService`.
 * Chủ đã thanh lý / ngừng dùng / cắt đường truyền mà két còn treo thì vẫn PHẢI hiện ở trang tổng
 * (để có người dọn), nhưng phải mang cờ `retired` — bảng điều khiển không được nhắc "đổi mật khẩu"
 * cho một máy đã bỏ.
 *
 * Trạng thái lấy qua cửa thật của từng module chủ (AD-2), trên DB thật.
 */

const TEST_TIMEOUT = 120_000;

describe('VaultOwnersService — cờ retired theo trạng thái hồ sơ chủ', () => {
  let scratch: ScratchDb;
  let owners: VaultOwnersService;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await createScratchDb('ims_vault_owners_retired');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devices = new DevicesService(
      db,
      catalog,
      audit,
      {} as DeviceRetirementRegistry,
      new DeviceSearchRegistry(),
    );
    const software = new SoftwareService(
      db,
      catalog,
      audit,
      {} as ExpiryApiService,
      {} as SystemConfigService,
    );
    const isp = new IspLineService(db, catalog, new DevicesApiService(devices), audit);

    const pool = scratch.pool;
    const providers = await seedIspProviders(pool, ['VNPT', 'FPT']);
    const type = await pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Loại E2E két') RETURNING id`,
    );
    const rows = async (sql: string, params: unknown[] = []) => {
      const r = await pool.query<{ id: string; code: string }>(sql, params);
      for (const row of r.rows) ids[row.code] = row.id;
    };
    await rows(
      `INSERT INTO device (code, name, device_type_id, status) VALUES
         ('E2E-KET-DEV-OLD', 'Máy đã bỏ', $1, 'retired'),
         ('E2E-KET-DEV-LIVE', 'Máy đang dùng', $1, 'in_use'),
         ('E2E-KET-DEV-BROKEN', 'Máy hỏng', $1, 'broken')
       RETURNING id, code`,
      [type.rows[0].id],
    );
    await rows(
      `INSERT INTO software (code, name, kind, status) VALUES
         ('E2E-KET-SW-OLD', 'Phần mềm đã bỏ', 'license', 'retired'),
         ('E2E-KET-SW-LIVE', 'Phần mềm đang dùng', 'license', 'active')
       RETURNING id, code`,
    );
    await rows(
      `INSERT INTO service_account (code, kind, name, status, created_by) VALUES
         ('E2E-KET-SA-OLD', 'vpn', 'TK đã khoá', 'disabled', 't'),
         ('E2E-KET-SA-LIVE', 'shared', 'TK đang dùng', 'active', 't')
       RETURNING id, code`,
    );
    await rows(
      `INSERT INTO isp_line (code, provider, provider_id, status) VALUES
         ('E2E-KET-ISP-OLD', 'VNPT', $1, 'terminated'),
         ('E2E-KET-ISP-LIVE', 'FPT', $2, 'suspended')
       RETURNING id, code`,
      [providers.VNPT, providers.FPT],
    );

    const summaries = [
      ['device', 'E2E-KET-DEV-OLD'],
      ['device', 'E2E-KET-DEV-LIVE'],
      ['device', 'E2E-KET-DEV-BROKEN'],
      ['software', 'E2E-KET-SW-OLD'],
      ['software', 'E2E-KET-SW-LIVE'],
      ['service_account', 'E2E-KET-SA-OLD'],
      ['service_account', 'E2E-KET-SA-LIVE'],
      ['isp', 'E2E-KET-ISP-OLD'],
      ['isp', 'E2E-KET-ISP-LIVE'],
    ].map(([ownerType, code]) => ({
      ownerType,
      ownerId: ids[code],
      secretCount: 1,
      lastChangeAt: new Date('2024-01-01T00:00:00Z'),
    }));
    // Két chỉ là nguồn danh sách chủ ở đây; thứ được kiểm là phần tra hồ sơ chủ qua module khác.
    const vault = {
      listOwnerSummaries: () => Promise.resolve(summaries),
    } as unknown as VaultService;
    owners = new VaultOwnersService(
      vault,
      new DevicesApiService(devices),
      new SoftwareApiService(software, isp),
      new ServiceAccountsApiService(new ServiceAccountService(db, audit, {} as ExpiryApiService)),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'thanh lý / ngừng dùng / cắt đường truyền → retired; còn dùng, hỏng, tạm ngưng → không',
    async () => {
      const list = await owners.list();
      const retiredOf = Object.fromEntries(list.map((row) => [row.code, row.retired]));
      expect(retiredOf).toEqual({
        'E2E-KET-DEV-OLD': true,
        'E2E-KET-DEV-LIVE': false,
        'E2E-KET-DEV-BROKEN': false,
        'E2E-KET-SW-OLD': true,
        'E2E-KET-SW-LIVE': false,
        'E2E-KET-SA-OLD': true,
        'E2E-KET-SA-LIVE': false,
        'E2E-KET-ISP-OLD': true,
        'E2E-KET-ISP-LIVE': false,
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'describe() — một chủ thể lẻ (phiếu break-glass) cũng mang cờ',
    async () => {
      expect(await owners.describe('device', ids['E2E-KET-DEV-OLD'])).toMatchObject({
        code: 'E2E-KET-DEV-OLD',
        retired: true,
        orphan: false,
      });
    },
    TEST_TIMEOUT,
  );
});

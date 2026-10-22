import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SoftwareService } from '../src/modules/software/software.service';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * PW-A12 (Q-33) — mã hồ sơ chỉ A–Z 0–9 - _ . /, tự in hoa. Chỉ áp cho mã MỚI và khi ĐỔI mã:
 * hồ sơ khai trước luật ("hồ sơ -1") vẫn sửa được các ô khác mà không phải đổi mã.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'pwa12@test';

async function rejectsWith(write: Promise<unknown>, code: string): Promise<void> {
  const error = await write.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect((error as { getResponse?: () => { code?: string } } | null)?.getResponse?.().code).toBe(code);
}

describe('Luật mã hồ sơ', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let software: SoftwareService;
  let isp: IspLineService;
  let accounts: ServiceAccountService;
  let typeId: string;
  let providerId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_record_code');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const catalog = new CatalogApiService(new CatalogService(scratch.db, audit));
    devices = new DevicesService(scratch.db, catalog, audit, {} as DeviceRetirementRegistry, new DeviceSearchRegistry());
    software = new SoftwareService(scratch.db, catalog, audit, {} as ExpiryApiService, new SystemConfigService(scratch.db));
    const deviceApi = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    isp = new IspLineService(scratch.db, catalog, deviceApi, audit);
    accounts = new ServiceAccountService(scratch.db, audit, {} as ExpiryApiService);
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    typeId = type.rows[0].id;
    providerId = (await seedIspProviders(scratch.pool, ['VNPT'])).VNPT;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('thiết bị: mã mới in hoa; có dấu / khoảng trắng → CODE_FORMAT_INVALID', async () => {
    const { device } = await devices.create(ACTOR, { code: ' pc-e2e-01 ', name: 'A', deviceTypeId: typeId });
    expect(device.code).toBe('PC-E2E-01');
    await rejectsWith(
      devices.create(ACTOR, { code: 'máy 02', name: 'B', deviceTypeId: typeId }),
      'CODE_FORMAT_INVALID',
    );
  });

  it('thiết bị: mã cũ sai luật vẫn sửa được ô khác; đổi sang mã sai thì bị chặn', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ('máy cũ 1', 'Cũ', $1) RETURNING id`,
      [typeId],
    );
    const { device } = await devices.update(ACTOR, rows[0].id, { code: 'máy cũ 1', name: 'Cũ đã sửa' });
    expect(device.code).toBe('máy cũ 1');
    await rejectsWith(
      devices.update(ACTOR, rows[0].id, { code: 'máy cũ 2' }),
      'CODE_FORMAT_INVALID',
    );
  });

  it('phần mềm: "hồ sơ -1" bị chặn khi thêm, mã thường thành in hoa', async () => {
    await rejectsWith(
      software.create(ACTOR, { code: 'hồ sơ -1', name: 'X', kind: 'maintenance', licenseModel: 'subscription' }),
      'CODE_FORMAT_INVALID',
    );
    const created = await software.create(ACTOR, {
      code: 'hd-e2e-01',
      name: 'X',
      kind: 'maintenance',
      licenseModel: 'subscription',
    });
    expect(created.code).toBe('HD-E2E-01');
  });

  it('phần mềm: mã cũ sai luật vẫn sửa được ô khác', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model) VALUES ('hồ sơ cũ', 'Cũ', 'maintenance', 'subscription') RETURNING id`,
    );
    const updated = await software.update(ACTOR, rows[0].id, { code: 'hồ sơ cũ', name: 'Cũ đã sửa' });
    expect(updated.code).toBe('hồ sơ cũ');
  });

  it('đường truyền: mã mới in hoa, mã có dấu bị chặn; mã cũ giữ khi sửa ô khác', async () => {
    const created = await isp.create(ACTOR, { code: 'isp-e2e-01', providerId });
    expect(created.code).toBe('ISP-E2E-01');
    await rejectsWith(
      isp.create(ACTOR, { code: 'đường 2', providerId }),
      'CODE_FORMAT_INVALID',
    );
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO isp_line (code, provider, provider_id) VALUES ('đường cũ', 'VNPT', $1) RETURNING id`,
      [providerId],
    );
    const updated = await isp.update(ACTOR, rows[0].id, { code: 'đường cũ', note: 'sửa' });
    expect(updated.code).toBe('đường cũ');
  });

  it('tài khoản dịch vụ: mã tự đặt mới in hoa, mã có khoảng trắng bị chặn', async () => {
    const created = await accounts.create(ACTOR, { kind: 'shared', code: 'tk-e2e-01', name: 'TK', login: 'a@pmh.com.vn' });
    expect(created.code).toBe('TK-E2E-01');
    await rejectsWith(
      accounts.create(ACTOR, { kind: 'shared', code: 'tk e2e 02', name: 'TK', login: 'b@pmh.com.vn' }),
      'CODE_FORMAT_INVALID',
    );
  });
});

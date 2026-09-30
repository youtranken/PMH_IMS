import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { SoftwareApiService } from '../src/modules/software/software.api';
import { AccessListService } from '../src/modules/vault/access-list.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import type { SoftwareService } from '../src/modules/software/software.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * SEC-13 — ma trận quyền két với tới đường truyền theo ID nhà mạng, không theo tên.
 *
 * Khoá theo tên thì đổi tên nhà mạng trong danh mục là lặng lẽ tước quyền: luật vẫn nằm đó,
 * màn ma trận hiện "(đã xóa)", còn người được gán bị từ chối mà không ai biết vì sao.
 */

const TEST_TIMEOUT = 120_000;
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;

describe('Tầng quyền trên đường truyền đi theo id nhà mạng', () => {
  let scratch: ScratchDb;
  let access: AccessListService;
  let catalog: CatalogService;
  let isp: IspLineService;
  let providers: Record<string, string>;
  const member = 'it01@pmh.com.vn';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_access_isp_tier');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    const catalogApi = new CatalogApiService(catalog);
    const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    isp = new IspLineService(scratch.db, catalogApi, devices, audit);
    access = new AccessListService(
      scratch.db,
      audit,
      catalogApi,
      devices,
      new SoftwareApiService({} as SoftwareService, isp),
      {} as ServiceAccountsApiService,
      {} as UsersApiService,
    );
    providers = await seedIspProviders(scratch.pool, ['FPT', 'VNPT']);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('ô chọn của ma trận khoá nhóm nhà mạng bằng id', async () => {
    const options = (await access.scopeOptions()).filter((o) => o.scopeType === 'isp_provider');
    expect(options).toEqual([
      { scopeType: 'isp_provider', scopeRef: providers.FPT, label: 'Đường truyền: FPT' },
      { scopeType: 'isp_provider', scopeRef: providers.VNPT, label: 'Đường truyền: VNPT' },
    ]);
  });

  it('đổi tên nhà mạng KHÔNG tước quyền đã gán (SEC-13)', async () => {
    const line = await isp.create('sa', { code: 'SEC13-01', providerId: providers.FPT });
    await scratch.pool.query(
      `INSERT INTO access_list (member_email, scope_type, scope_ref, tier, granted_by)
       VALUES ($1, 'isp_provider', $2, 'whitelist', 'sa')`,
      [member, providers.FPT],
    );
    expect(await access.tierFor(member, 'isp', line.id)).toBe('whitelist');

    await catalog.update('sa', 'isp_provider', providers.FPT, { name: 'FPT Telecom' });
    expect(await access.tierFor(member, 'isp', line.id)).toBe('whitelist');
    const label = (await access.list(member))[0].scopeLabel;
    expect(label).toBe('Đường truyền: FPT Telecom');
  });

  it('đường truyền của nhà mạng khác vẫn CẤM', async () => {
    const other = await isp.create('sa', { code: 'SEC13-02', providerId: providers.VNPT });
    expect(await access.tierFor(member, 'isp', other.id)).toBe('denied');
  });

  it('Kiểm tra quyền giải thích được: nhóm của đường truyền + dòng quyền đã khớp (ADM-083)', async () => {
    const line = await isp.create('sa', { code: 'SEC13-03', providerId: providers.FPT });
    expect(await access.explainTierFor(member, 'isp', line.id)).toEqual({
      tier: 'whitelist',
      groups: [{ scopeType: 'isp_provider', scopeRef: providers.FPT }],
      matched: [{ scopeType: 'isp_provider', scopeRef: providers.FPT, tier: 'whitelist' }],
    });
    const other = await isp.create('sa', { code: 'SEC13-04', providerId: providers.VNPT });
    expect(await access.explainTierFor(member, 'isp', other.id)).toEqual({
      tier: 'denied',
      groups: [{ scopeType: 'isp_provider', scopeRef: providers.VNPT }],
      matched: [],
    });
  });
});

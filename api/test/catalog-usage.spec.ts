import { runMigrations } from '../src/database/migration-runner';
import { CatalogUsageRegistry } from '../src/common/catalog-usage.registry';
import { CatalogOwnUsage } from '../src/modules/catalog/catalog-usage';
import { DeviceCatalogUsage } from '../src/modules/devices/device-catalog-usage';
import { IpamCatalogUsage } from '../src/modules/ipam/ipam-catalog-usage';
import { ServiceAccountCatalogUsage } from '../src/modules/service-accounts/service-account-catalog-usage';
import { SoftwareCatalogUsage } from '../src/modules/software/software-catalog-usage';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * "Đang dùng ở N …" của màn Danh mục (Q-15): mỗi module chủ dữ liệu tự đếm bảng của mình rồi
 * ghi vào `CatalogUsageRegistry`. Chạy trên Postgres thật vì con số là GROUP BY trên bảng thật,
 * và bộ phận được so bằng `lower(btrim())` của DB — thứ mock không trả lời được.
 */

const TEST_TIMEOUT = 120_000;

describe('Danh mục · số hồ sơ đang dùng từng mục', () => {
  let scratch: ScratchDb;
  const registry = new CatalogUsageRegistry();
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_usage');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    for (const counter of [
      new CatalogOwnUsage(scratch.db, registry),
      new DeviceCatalogUsage(scratch.db, registry),
      new SoftwareCatalogUsage(scratch.db, registry),
      new IpamCatalogUsage(scratch.db, registry),
      new ServiceAccountCatalogUsage(scratch.db, registry),
    ]) {
      counter.onModuleInit();
    }

    id.hcm = await one(`INSERT INTO site (code, name) VALUES ('E2E-HCM', 'HCM') RETURNING id`);
    id.dn = await one(`INSERT INTO site (code, name) VALUES ('E2E-DN', 'Đà Nẵng') RETURNING id`);
    id.tu1 = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'TU-01') RETURNING id`, [id.hcm]);
    await scratch.pool.query(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'TU-02')`, [id.hcm]);
    id.pc = await one(`INSERT INTO device_type (name) VALUES ('PC E2E') RETURNING id`);
    id.sw = await one(`INSERT INTO device_type (name) VALUES ('Switch E2E') RETURNING id`);
    id.dell = await one(`INSERT INTO vendor (name) VALUES ('Dell E2E') RETURNING id`);
    id.ketoan = await one(`INSERT INTO department (name) VALUES ('Kế toán E2E') RETURNING id`);
    id.it = await one(`INSERT INTO department (name) VALUES ('IT E2E') RETURNING id`);

    const device = (code: string, extra: Record<string, string | null>) =>
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id, vendor_id, department)
         VALUES ($1, $7, $2, $3, $4, $5, $6)`,
        [code, extra.type, extra.site ?? null, extra.cabinet ?? null, extra.vendor ?? null, extra.dept ?? null, code],
      );
    await device('E2E-PC-1', { type: id.pc, site: id.hcm, cabinet: id.tu1, vendor: id.dell, dept: 'Kế toán E2E' });
    // Ô bộ phận là chữ tự do ở hồ sơ cũ: khác hoa thường, thừa khoảng trắng vẫn là một bộ phận.
    await device('E2E-PC-2', { type: id.pc, site: id.hcm, dept: '  kế TOÁN e2e ' });
    await device('E2E-SW-1', { type: id.sw, site: id.dn });

    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, vendor_id) VALUES ('E2E-SW', 'Office E2E', 'license', $1)`,
      [id.dell],
    );
    await scratch.pool.query(
      `INSERT INTO subnet (name, cidr, site_id, created_by) VALUES ('E2E LAN', '10.250.0.0/24', $1, 't')`,
      [id.hcm],
    );
    await scratch.pool.query(
      `INSERT INTO service_account (code, kind, name, department, created_by) VALUES ('E2E-SA', 'shared', 'E2E hộp thư', 'Kế toán E2E', 't')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  });

  const refs = (...keys: string[]) => keys.map((key) => ({ id: id[key], name: key }));

  it('site: số thiết bị, tủ mạng và dải IP trỏ tới nó; site không ai dùng thì rỗng', async () => {
    const usage = await registry.usageOf('site', [...refs('hcm', 'dn'), { id: id.pc, name: 'x' }]);
    expect(usage.get(id.hcm)).toEqual(
      expect.arrayContaining([
        { kind: 'cabinet', count: 2 },
        { kind: 'device', count: 2 },
        { kind: 'subnet', count: 1 },
      ]),
    );
    expect(usage.get(id.hcm)).toHaveLength(3);
    expect(usage.get(id.dn)).toEqual([{ kind: 'device', count: 1 }]);
    expect(usage.get(id.pc)).toEqual([]);
  });

  it('tủ, loại thiết bị, nhà cung cấp', async () => {
    expect((await registry.usageOf('cabinet', refs('tu1'))).get(id.tu1)).toEqual([
      { kind: 'device', count: 1 },
    ]);
    const types = await registry.usageOf('device_type', refs('pc', 'sw'));
    expect(types.get(id.pc)).toEqual([{ kind: 'device', count: 2 }]);
    expect(types.get(id.sw)).toEqual([{ kind: 'device', count: 1 }]);
    expect((await registry.usageOf('vendor', refs('dell'))).get(id.dell)).toEqual(
      expect.arrayContaining([
        { kind: 'device', count: 1 },
        { kind: 'software', count: 1 },
      ]),
    );
  });

  it('bộ phận đếm theo TÊN, không phân biệt hoa thường/khoảng trắng, kể cả chữ có dấu', async () => {
    const usage = await registry.usageOf('department', [
      { id: id.ketoan, name: 'Kế toán E2E' },
      { id: id.it, name: 'IT E2E' },
    ]);
    expect(usage.get(id.ketoan)).toEqual(
      expect.arrayContaining([
        { kind: 'device', count: 2 },
        { kind: 'service_account', count: 1 },
      ]),
    );
    expect(usage.get(id.it)).toEqual([]);
  });
});

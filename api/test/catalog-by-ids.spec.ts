import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Tra tủ / nhà cung cấp theo id (kể cả mục đã ngừng dùng) — nơi cần MỘT tủ (khung tủ, U vượt tủ,
 * thẻ máy trên sơ đồ) không phải đọc cả tám danh mục để tìm nó.
 */

const TEST_TIMEOUT = 120_000;
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;

describe('Danh mục · tra tủ / nhà cung cấp theo id', () => {
  let scratch: ScratchDb;
  let api: CatalogApiService;
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_by_ids');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    api = new CatalogApiService(new CatalogService(scratch.db, audit));
    id.site = await one(`INSERT INTO site (code, name) VALUES ('E2E-BYID', 'Site') RETURNING id`);
    id.cab = await one(`INSERT INTO cabinet (site_id, code, u_height) VALUES ($1, 'R-E2E-1', 42) RETURNING id`, [id.site]);
    id.cabOff = await one(`INSERT INTO cabinet (site_id, code, active) VALUES ($1, 'R-E2E-2', false) RETURNING id`, [id.site]);
    id.vendor = await one(`INSERT INTO vendor (name, phone) VALUES ('NCC E2E BYID', '0901') RETURNING id`);
    id.vendorOff = await one(`INSERT INTO vendor (name, active) VALUES ('NCC cũ E2E BYID', false) RETURNING id`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  });

  it('tủ theo id: kèm mã site, chiều cao, cả tủ đã ngừng dùng; id lạ/không phải uuid thì vắng', async () => {
    const cabinets = await api.cabinetsByIds([id.cab, id.cabOff, '00000000-0000-4000-8000-000000000000', 'không-phải-uuid']);
    expect([...cabinets.keys()].sort()).toEqual([id.cab, id.cabOff].sort());
    expect(cabinets.get(id.cab)).toMatchObject({ code: 'R-E2E-1', siteCode: 'E2E-BYID', uHeight: 42, active: true });
    expect(cabinets.get(id.cabOff)).toMatchObject({ code: 'R-E2E-2', active: false });
    expect((await api.cabinetsByIds([])).size).toBe(0);
  });

  it('nhà cung cấp theo id, cả mục đã ngừng dùng', async () => {
    const vendors = await api.vendorsByIds([id.vendor, id.vendorOff]);
    expect(vendors.get(id.vendor)).toMatchObject({ name: 'NCC E2E BYID', phone: '0901' });
    expect(vendors.get(id.vendorOff)).toMatchObject({ active: false });
  });
});

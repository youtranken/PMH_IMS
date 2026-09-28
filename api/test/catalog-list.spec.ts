import { runMigrations } from '../src/database/migration-runner';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Danh sách danh mục ở màn quản trị: sắp theo thứ tự chữ TIẾNG VIỆT (ADM-016), lọc theo trạng
 * thái (ADM-027) và lọc tủ theo site (ADM-026).
 *
 * Phải chạy trên Postgres thật: thứ tự sắp là việc của collation ICU trong DB, không phải của
 * mã TypeScript — mock thì bài xanh cả khi DB không có `vi-x-icu`.
 */

const TEST_TIMEOUT = 120_000;
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const page = { page: 1, limit: 50 };

describe('Danh mục · sắp tiếng Việt và bộ lọc', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_list');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    for (const name of ['UPS E2E', 'Kinh doanh E2E', 'Điện thoại IP E2E', 'Kế toán E2E', 'An ninh E2E']) {
      await scratch.pool.query(`INSERT INTO department (name) VALUES ($1)`, [name]);
    }
    await scratch.pool.query(`UPDATE department SET active = false WHERE name = 'UPS E2E'`);
    id.hcm = await one(`INSERT INTO site (code, name) VALUES ('E2E-HCM', 'HCM') RETURNING id`);
    id.dn = await one(`INSERT INTO site (code, name) VALUES ('E2E-DN', 'Đà Nẵng') RETURNING id`);
    await scratch.pool.query(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'TU-01'), ($1, 'TU-02')`, [id.hcm]);
    await scratch.pool.query(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'TU-01')`, [id.dn]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  });

  it('tên sắp theo bảng chữ tiếng Việt: Đ sau D, "Kế" trước "Kinh", không rơi xuống sau "U"', async () => {
    const result = await catalog.list('department', page);
    expect(result.items.map((row) => (row as { name: string }).name)).toEqual([
      'An ninh E2E',
      'Điện thoại IP E2E',
      'Kế toán E2E',
      'Kinh doanh E2E',
      'UPS E2E',
    ]);
  });

  it('ô chọn (danh sách gọn) cũng sắp tiếng Việt', async () => {
    const lists = await catalog.lists();
    expect(lists.departments.map((row) => row.name)).toEqual([
      'An ninh E2E',
      'Điện thoại IP E2E',
      'Kế toán E2E',
      'Kinh doanh E2E',
    ]);
  });

  it('lọc trạng thái: chỉ đang dùng / chỉ đã vô hiệu / vắng = cả hai', async () => {
    const active = await catalog.list('department', page, undefined, undefined, { active: true });
    const inactive = await catalog.list('department', page, undefined, undefined, { active: false });
    const all = await catalog.list('department', page);
    expect(active.total).toBe(4);
    expect(inactive.items.map((row) => (row as { name: string }).name)).toEqual(['UPS E2E']);
    expect(all.total).toBe(5);
  });

  it('lọc tủ theo site', async () => {
    const hcm = await catalog.list('cabinet', page, undefined, undefined, { siteId: id.hcm });
    expect(hcm.total).toBe(2);
    expect(hcm.items.every((row) => (row as { siteId: string }).siteId === id.hcm)).toBe(true);
  });
});

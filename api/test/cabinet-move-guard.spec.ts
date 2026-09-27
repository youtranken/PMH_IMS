import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-08 — dời tủ mạng sang site khác khi trong tủ còn thiết bị.
 *
 * Thiết bị giữ `site_id` cũ mà `cabinet_id` lại trỏ vào một tủ đã sang site mới: lọc theo site
 * nào cũng lệch, và form sửa thiết bị báo "tủ không thuộc site đã chọn" cho một hồ sơ không ai
 * đụng tới. `catalog` không được đếm bảng `device` (AD-2), nên trọng tài là ràng buộc DB — bài
 * này hỏi đúng ràng buộc đó trên Postgres thật, kể cả với một lượt UPDATE không qua service.
 */

const TEST_TIMEOUT = 120_000;

describe('BE-08 · dời tủ còn thiết bị sang site khác', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  let siteA: string;
  let siteB: string;
  let fullCabinet: string;
  let emptyCabinet: string;

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_cabinet_move');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    siteA = await one(`INSERT INTO site (code, name) VALUES ('E2E-A', 'Site A') RETURNING id`);
    siteB = await one(`INSERT INTO site (code, name) VALUES ('E2E-B', 'Site B') RETURNING id`);
    fullCabinet = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R01') RETURNING id`, [siteA]);
    emptyCabinet = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R02') RETURNING id`, [siteA]);
    const type = await one(`INSERT INTO device_type (name) VALUES ('Switch E2E tu') RETURNING id`);
    await scratch.pool.query(
      `INSERT INTO device (code, name, device_type_id, status, site_id, cabinet_id)
       VALUES ('SW-E2E-01', 'Switch tang 1', $1, 'in_use', $2, $3)`,
      [type, siteA, fullCabinet],
    );
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    catalog = new CatalogService(scratch.db, audit);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('tủ còn thiết bị → 409 CABINET_HAS_DEVICES, tủ vẫn ở site cũ', async () => {
    await expect(
      catalog.update('sa@pmh.com.vn', 'cabinet', fullCabinet, { siteId: siteB }),
    ).rejects.toMatchObject({ response: { code: 'CABINET_HAS_DEVICES' } });
    const { rows } = await scratch.pool.query(`SELECT site_id FROM cabinet WHERE id = $1`, [fullCabinet]);
    expect(rows[0].site_id).toBe(siteA);
  });

  it('UPDATE thẳng vào DB cũng bị chặn — trọng tài là ràng buộc, không phải service', async () => {
    await expect(
      scratch.pool.query(`UPDATE cabinet SET site_id = $1 WHERE id = $2`, [siteB, fullCabinet]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('tủ trống → dời được', async () => {
    const moved = await catalog.update('sa@pmh.com.vn', 'cabinet', emptyCabinet, { siteId: siteB });
    expect((moved as { siteId: string }).siteId).toBe(siteB);
  });

  it('sửa mã tủ còn thiết bị (không đổi site) vẫn được', async () => {
    const renamed = await catalog.update('sa@pmh.com.vn', 'cabinet', fullCabinet, { code: 'R01-E2E' });
    expect((renamed as { code: string }).code).toBe('R01-E2E');
  });
});

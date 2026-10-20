import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { createScratchDb, migrationsDir, type ScratchDb, waitForLock } from './db';

/**
 * Hai người sửa cùng một mục danh mục cùng lúc: bản "trước khi sửa" ghi vào `catalog_history`
 * (chỉ-thêm) phải là giá trị THẬT ngay trước lượt ghi đó. Đọc `before` ngoài transaction thì lượt
 * sau chép lại giá trị cũ, và lịch sử nói "đổi từ X" trong khi lúc đó nó đã là giá trị của lượt
 * trước — một dòng lịch sử sai không sửa được.
 */

const TEST_TIMEOUT = 120_000;
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;

describe('sửa danh mục chồng nhau ghi đúng "trước khi sửa"', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_update_race');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('lượt sau ghi "trước" = giá trị lượt trước vừa ghi', async () => {
    const vendor = await catalog.create('race@test', 'vendor', { name: 'E2E NCC gốc' });
    const blocker = await scratch.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM vendor WHERE id = $1 FOR UPDATE', [vendor.id]);
      const first = catalog.update('a@test', 'vendor', vendor.id, { name: 'E2E NCC A' });
      void first.catch(() => undefined);
      await waitForLock(scratch.pool);
      const second = catalog.update('b@test', 'vendor', vendor.id, { name: 'E2E NCC B' });
      void second.catch(() => undefined);
      await waitForLock(scratch.pool, 10_000, 2);
      await blocker.query('COMMIT');
      await Promise.all([first, second]);
    } finally {
      blocker.release();
    }
    const { rows } = await scratch.pool.query<{ changes: { before: { name?: string }; after: { name?: string } } }>(
      `SELECT changes FROM catalog_history WHERE entity_id = $1 AND action = 'updated' ORDER BY created_at, id`,
      [vendor.id],
    );
    expect(rows).toHaveLength(2);
    // Không dựa vào thứ tự created_at (now() là giờ BẮT ĐẦU transaction): đúng một lượt đổi từ giá
    // trị gốc, lượt còn lại phải đổi từ đúng giá trị lượt kia vừa ghi.
    const fromOriginal = rows.filter((r) => r.changes.before.name === 'E2E NCC gốc');
    expect(fromOriginal).toHaveLength(1);
    const other = rows.find((r) => r !== fromOriginal[0])!;
    expect(other.changes.before.name).toBe(fromOriginal[0].changes.after.name);
  }, TEST_TIMEOUT);
});

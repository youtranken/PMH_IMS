import { runMigrations } from '../src/database/migration-runner';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ẩn / hiện nhiều mục danh mục một lượt (UX-E25): MỘT transaction — mục nào không có thì cả lượt
 * không đổi gì; mục đã đúng trạng thái thì bỏ qua, không ghi lịch sử rỗng.
 */

const TEST_TIMEOUT = 120_000;

describe('Danh mục · ẩn / hiện hàng loạt', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  const audited: string[] = [];
  const audit = {
    appendWithin: (_tx: unknown, row: { action: string; objectId: string }) => {
      audited.push(`${row.action}:${row.objectId}`);
      return Promise.resolve();
    },
  } as unknown as AuditWriterService;
  const id: Record<string, string> = {};

  async function one(text: string, params: unknown[] = []): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(text, params);
    return rows[0].id;
  }
  async function activeOf(ids: string[]): Promise<boolean[]> {
    const { rows } = await scratch.pool.query<{ id: string; active: boolean }>(
      'SELECT id, active FROM vendor WHERE id = ANY($1)',
      [ids],
    );
    return ids.map((x) => rows.find((r) => r.id === x)!.active);
  }
  async function historyCount(): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: string }>("SELECT count(*) AS n FROM catalog_history WHERE entity = 'vendor'");
    return Number(rows[0].n);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_catalog_bulk_active');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    id.a = await one(`INSERT INTO vendor (name) VALUES ('NCC E2E BULK A') RETURNING id`);
    id.b = await one(`INSERT INTO vendor (name) VALUES ('NCC E2E BULK B') RETURNING id`);
    id.off = await one(`INSERT INTO vendor (name, active) VALUES ('NCC E2E BULK OFF', false) RETURNING id`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  });

  it('ẩn ba mục, một mục đã ẩn sẵn: chỉ hai mục đổi và ghi lịch sử', async () => {
    const before = await historyCount();
    const changed = await catalog.setActiveMany('sa@pmh.com.vn', 'vendor', [id.a, id.b, id.off], false);
    expect(changed).toBe(2);
    expect(await activeOf([id.a, id.b, id.off])).toEqual([false, false, false]);
    expect((await historyCount()) - before).toBe(2);
    expect(audited.filter((x) => x.startsWith('catalog.vendor.deactivated'))).toHaveLength(2);
  });

  it('có một id không tồn tại thì cả lượt không đổi gì', async () => {
    await expect(
      catalog.setActiveMany('sa@pmh.com.vn', 'vendor', [id.a, '00000000-0000-4000-8000-000000000000'], true),
    ).rejects.toMatchObject({ status: 404 });
    expect(await activeOf([id.a])).toEqual([false]);
  });

  it('hiện lại hai mục', async () => {
    expect(await catalog.setActiveMany('sa@pmh.com.vn', 'vendor', [id.a, id.b], true)).toBe(2);
    expect(await activeOf([id.a, id.b])).toEqual([true, true]);
  });
});

import { runMigrations } from '../src/database/migration-runner';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * NET-041 (Q-14): loại thiết bị có cờ "Router/Firewall" — ô Router của sổ NAT chỉ liệt kê
 * thiết bị thuộc loại mang cờ này, thay vì mọi thiết bị kể cả camera.
 *
 * Kiểm trên DB trắng: migration gieo cờ cho loại có sẵn tên router/firewall, và sửa cờ ở màn
 * Danh mục đi đúng đường ghi + lịch sử như mọi trường khác.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'router-flag@test';

describe('Cờ Router/Firewall trên loại thiết bị', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  const audits: { action: string; detail: unknown }[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_type_router');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = {
      appendWithin: (_tx: unknown, entry: { action: string; detail: unknown }) => {
        audits.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditWriterService;
    catalog = new CatalogService(scratch.db, audit);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('migration gieo cờ cho loại "Firewall" có sẵn, không gieo cho Camera/PC', async () => {
    const { rows } = await scratch.pool.query<{ name: string; is_router: boolean }>(
      `SELECT name::text, is_router FROM device_type WHERE name IN ('Firewall', 'Camera', 'PC')
        ORDER BY name`,
    );
    expect(rows).toEqual([
      { name: 'Camera', is_router: false },
      { name: 'Firewall', is_router: true },
      { name: 'PC', is_router: false },
    ]);
  });

  it('loại mới mặc định KHÔNG phải router', async () => {
    const created = await catalog.create(actor, 'device_type', { name: 'Máy chấm công E2E' });
    expect(created).toMatchObject({ isRouter: false });
  });

  it('sửa cờ ở Danh mục: ghi xuống, ra ở danh sách, và có trong lịch sử + audit', async () => {
    const created = await catalog.create(actor, 'device_type', { name: 'Draytek E2E' });
    audits.length = 0;
    await catalog.update(actor, 'device_type', created.id, { isRouter: true });

    const lists = await catalog.lists();
    expect(lists.deviceTypes.find((t) => t.id === created.id)).toMatchObject({ isRouter: true });

    const history = await scratch.pool.query<{ changes: { after: Record<string, unknown> } }>(
      `SELECT changes FROM catalog_history WHERE entity_id = $1 AND action = 'updated'`,
      [created.id],
    );
    expect(history.rows[0].changes.after).toMatchObject({ isRouter: true });
    expect(audits).toEqual([
      expect.objectContaining({ action: 'catalog.device_type.updated' }),
    ]);
  });
});

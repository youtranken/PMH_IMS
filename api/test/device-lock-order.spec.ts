import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { createScratchDb, migrationsDir, type ScratchDb, waitForLock } from './db';


/**
 * Khoá hàng loạt hồ sơ thiết bị (import) phải theo THỨ TỰ id toàn cục, không chỉ trong từng lô 500:
 * hai lượt import cùng đụng 1.000 máy nhưng file xếp khác thứ tự thì mỗi bên khoá xong lô đầu của
 * mình rồi chờ lô của bên kia — Postgres huỷ một bên vì deadlock.
 */

const TEST_TIMEOUT = 300_000;
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

describe('requireRowsWithin khoá theo thứ tự id toàn cục', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_lock_order');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = new AuditWriterService(scratch.db);
    devices = new DevicesService(scratch.db, new CatalogApiService(new CatalogService(scratch.db, audit)), audit, noRetirement, new DeviceSearchRegistry());
    const { rows } = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('PC LOCK E2E') RETURNING id`);
    await scratch.pool.query(
      `INSERT INTO device (code, name, device_type_id) SELECT 'E2E-LK-' || g, 'May ' || g, $1 FROM generate_series(1, 1000) g`,
      [rows[0].id],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('hai lượt khoá cùng 1.000 máy theo hai thứ tự ngược nhau: không deadlock, cả hai xong', async () => {
    const { rows } = await scratch.pool.query<{ id: string }>(`SELECT id FROM device ORDER BY code`);
    const ids = rows.map((r) => r.id);
    const lockAll = (order: string[]) =>
      scratch.db.transaction(async (tx) => {
        await devices.requireRowsWithin(tx, order, 'update');
      });
    /*
     * Kết nối thứ ba giữ khoá một máy ở NỬA SAU để hai lượt cùng đứng chờ giữa chừng: lượt xuôi đã
     * giữ nửa đầu, lượt ngược đã giữ một phần nửa sau. Thả ra là mỗi bên cần đúng phần bên kia
     * đang giữ — nếu khoá không theo thứ tự id toàn cục.
     */
    const blocker = await scratch.pool.connect();
    let results: PromiseSettledResult<void>[];
    try {
      await blocker.query('BEGIN');
      const tail = [...ids.slice(500)].sort();
      await blocker.query('SELECT 1 FROM device WHERE id = $1 FOR UPDATE', [tail[tail.length - 1]]);
      const forward = lockAll(ids);
      void forward.catch(() => undefined);
      const backward = lockAll([...ids].reverse());
      void backward.catch(() => undefined);
      await waitForLock(scratch.pool, 20_000, 2);
      await blocker.query('COMMIT');
      results = await Promise.allSettled([forward, backward]);
    } finally {
      blocker.release();
    }
    expect(results.map((r) => (r.status === 'rejected' ? String((r.reason as { cause?: unknown }).cause ?? r.reason) : 'ok'))).toEqual(['ok', 'ok']);
  }, TEST_TIMEOUT);
});

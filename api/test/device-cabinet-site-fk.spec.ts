import { ConflictException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { DevicesService } from '../src/modules/devices/devices.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-08 (vế còn lại) — khoá ngoại (site, tủ) của thiết bị là lưới cuối khi một lượt dời tủ đua với
 * một lượt ghi thiết bị. Chạm nó thì người dùng phải nhận 409 nói đúng chuyện, không phải 500.
 */
const TEST_TIMEOUT = 120_000;

describe('BE-08 · lỗi khoá ngoại tủ–site của thiết bị được dịch thành 409', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_dev_cab_fk');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const noAudit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const noRetirement = {
      holdingsWithin: () => Promise.resolve([]),
      releaseAllWithin: () => Promise.resolve(),
    } as unknown as DeviceRetirementRegistry;
    devices = new DevicesService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, noAudit)),
      noAudit,
      noRetirement,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('ghi thiết bị với tủ không thuộc site → 409 CABINET_SITE_MISMATCH', async () => {
    const one = async (q: string, p: unknown[] = []) =>
      (await scratch.pool.query<{ id: string }>(q, p)).rows[0].id;
    const siteA = await one(`INSERT INTO site (code, name) VALUES ('FK-A', 'A') RETURNING id`);
    const siteB = await one(`INSERT INTO site (code, name) VALUES ('FK-B', 'B') RETURNING id`);
    const cab = await one(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'R1') RETURNING id`, [siteA]);
    const type = await one(`INSERT INTO device_type (name) VALUES ('PC fk') RETURNING id`);
    const dev = await one(
      `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id)
       VALUES ('PC-FK-1', 'May', $1, $2, $3) RETURNING id`,
      [type, siteA, cab],
    );
    const attempt = scratch.db.transaction((tx) => devices.updateWithin(tx, dev, { siteId: siteB }));
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(
      scratch.db.transaction((tx) => devices.updateWithin(tx, dev, { siteId: siteB })),
    ).rejects.toMatchObject({ response: { code: 'CABINET_SITE_MISMATCH' } });
  });
});

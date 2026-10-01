import { runMigrations } from '../src/database/migration-runner';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { createScratchDb, type ScratchDb, migrationsDir } from './db';

/**
 * Q-20 — ô chọn thiết bị của NAT / Đường truyền lọc theo NHIỀU loại một lượt (Firewall + Core +
 * Router…). `deviceTypeIds` là HỢP các loại; mảng rỗng là không lọc.
 */

const TEST_TIMEOUT = 120_000;
const PAGE = { page: 1, limit: 200 };

describe('Q-20 · lọc thiết bị theo nhiều loại', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  const type: Record<string, string> = {};

  async function codes(filter: Parameters<DevicesService['list']>[1]): Promise<string[]> {
    const page = await devices.list(PAGE, filter);
    return page.items.map((d) => d.code).sort();
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_type_ids');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    devices = new DevicesService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, audit)),
      audit,
      {} as DeviceRetirementRegistry,
      new DeviceSearchRegistry(),
    );
    for (const name of ['FW E2E loai', 'Core E2E loai', 'PC E2E loai']) {
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device_type (name) VALUES ($1) RETURNING id`,
        [name],
      );
      type[name] = rows[0].id;
    }
    const add = (code: string, typeName: string) =>
      scratch.pool.query(
        `INSERT INTO device (code, name, device_type_id, status) VALUES ($1, 'May', $2, 'in_use')`,
        [code, type[typeName]],
      );
    await add('E2E-LOAI-FW', 'FW E2E loai');
    await add('E2E-LOAI-CORE', 'Core E2E loai');
    await add('E2E-LOAI-PC', 'PC E2E loai');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'hợp nhiều loại; rỗng là không lọc',
    async () => {
      expect(
        await codes({ deviceTypeIds: [type['FW E2E loai'], type['Core E2E loai']] }),
      ).toEqual(['E2E-LOAI-CORE', 'E2E-LOAI-FW']);
      expect(await codes({ deviceTypeIds: [type['PC E2E loai']] })).toEqual(['E2E-LOAI-PC']);
      expect(await codes({ deviceTypeIds: [] })).toEqual([
        'E2E-LOAI-CORE',
        'E2E-LOAI-FW',
        'E2E-LOAI-PC',
      ]);
    },
    TEST_TIMEOUT,
  );
});

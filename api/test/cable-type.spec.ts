import { runMigrations } from '../src/database/migration-runner';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { CatalogUsageRegistry } from '../src/common/catalog-usage.registry';
import { DeviceCatalogUsage } from '../src/modules/devices/device-catalog-usage';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Loại dây (Q-23): danh mục `cable_type` của `catalog` seed đúng Cat6/Fiber/DAC, màu là
 * một ô màu token (1..8) chứ không phải mã hex; `device_port.cable_type_id` của `devices` trỏ vào
 * đó, loại đã ngừng dùng không chọn MỚI được nhưng dòng cũ vẫn sửa được (Q-14).
 */

const TEST_TIMEOUT = 120_000;
const actor = 'cable-type@test';
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

describe('loại dây', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  let ports: DevicePortsService;
  let typeId: string;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_cable_type');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    catalog = new CatalogService(scratch.db, audit);
    const devices = new DevicesService(scratch.db, new CatalogApiService(catalog), audit, noRetirement, new DeviceSearchRegistry());
    ports = new DevicePortsService(scratch.db, devices);
    const { rows } = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E dây') RETURNING id`);
    typeId = rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function device(): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
      [`E2E-CABLE-${seq}`, typeId],
    );
    return rows[0].id;
  }

  async function cableId(name: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>('SELECT id FROM cable_type WHERE name = $1', [name]);
    return rows[0].id;
  }

  it('migration seed ĐÚNG ba loại Cat6, Fiber, DAC với ô màu 1, 2, 3', async () => {
    const { rows } = await scratch.pool.query<{ name: string; color_slot: number; active: boolean }>(
      'SELECT name, color_slot, active FROM cable_type ORDER BY color_slot',
    );
    expect(rows).toEqual([
      { name: 'Cat6', color_slot: 1, active: true },
      { name: 'Fiber', color_slot: 2, active: true },
      { name: 'DAC', color_slot: 3, active: true },
    ]);
  });

  it('DB chỉ nhận ô màu 1..8 — không có chỗ cho mã hex', async () => {
    await expect(
      scratch.pool.query(`INSERT INTO cable_type (name, color_slot) VALUES ('E2E Hex', 9)`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'cable_type_color_slot_check' });
  });

  it('danh mục tạo được loại mới (ô màu), có lịch sử, nằm trong danh sách đổ ô chọn', async () => {
    const created = await catalog.create(actor, 'cable_type', { name: 'E2E Cat5e', colorSlot: 4, description: 'Dây cũ' });
    expect(created).toMatchObject({ name: 'E2E Cat5e', colorSlot: 4, active: true });
    const history = await catalog.history('cable_type', created.id);
    expect(history.map((h) => h.action)).toEqual(['created']);
    const lists = await catalog.lists();
    expect(lists.cableTypes.map((c) => c.name)).toContain('E2E Cat5e');
  });

  it('ô màu ngoài 1..8 → 400 CABLE_COLOR_SLOT_INVALID', async () => {
    await expect(catalog.create(actor, 'cable_type', { name: 'E2E Sai màu', colorSlot: 0 })).rejects.toMatchObject({
      response: { code: 'CABLE_COLOR_SLOT_INVALID' },
    });
  });

  it('dòng sơ đồ cổng mang loại dây; danh sách cổng trả lại `cableTypeId`', async () => {
    const sw = await device();
    const srv = await device();
    const fiber = await cableId('Fiber');
    const row = await ports.create(actor, sw, { portLabel: 'Te1/0/1', connectedDeviceId: srv, connectedPort: 'eth0', cableTypeId: fiber });
    expect(row.cableTypeId).toBe(fiber);
    const map = await ports.listFor(srv);
    expect(map.incoming[0].cableTypeId).toBe(fiber);
  });

  it('loại dây không tồn tại → 400 CATALOG_REF_INVALID', async () => {
    const sw = await device();
    await expect(
      ports.create(actor, sw, { portLabel: 'Gi1', cableTypeId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ response: { code: 'CATALOG_REF_INVALID' } });
  });

  it('loại đã ngừng dùng: không chọn MỚI được, dòng vốn mang nó vẫn sửa được ô khác (Q-14)', async () => {
    const sw = await device();
    const old = await catalog.create(actor, 'cable_type', { name: 'E2E Coax', colorSlot: 5 });
    const row = await ports.create(actor, sw, { portLabel: 'Gi9', cableTypeId: old.id });
    await catalog.setActive(actor, 'cable_type', old.id, false);

    await expect(ports.create(actor, sw, { portLabel: 'Gi10', cableTypeId: old.id })).rejects.toMatchObject({
      response: { code: 'CATALOG_REF_INACTIVE' },
    });
    const edited = await ports.update(actor, sw, row.id, { note: 'giữ dây cũ', cableTypeId: old.id });
    expect(edited.cableTypeId).toBe(old.id);
  });

  it('loại đang có dây dùng không xoá được → 409 CATALOG_IN_USE', async () => {
    const sw = await device();
    const used = await catalog.create(actor, 'cable_type', { name: 'E2E Đang dùng', colorSlot: 6 });
    await ports.create(actor, sw, { portLabel: 'Gi1', cableTypeId: used.id });
    await expect(catalog.remove(actor, 'cable_type', used.id)).rejects.toMatchObject({ response: { code: 'CATALOG_IN_USE' } });
    // Màn Danh mục báo trước "Đang dùng ở N dây" thay vì để bấm Xoá rồi mới nhận 409.
    const registry = new CatalogUsageRegistry();
    new DeviceCatalogUsage(scratch.db, registry).onModuleInit();
    expect((await registry.usageOf('cable_type', [{ id: used.id, name: 'E2E Đang dùng' }])).get(used.id)).toEqual([{ kind: 'port', count: 1 }]);
  });
});

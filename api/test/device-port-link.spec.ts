import { runMigrations } from '../src/database/migration-runner';
import { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesService } from '../src/modules/devices/devices.service';
import { PortDeviceRetirement } from '../src/modules/devices/port-device-retirement';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Đường ghi sơ đồ cổng mà màn sơ đồ mạng gọi sau khi người dùng bấm "Khai" / "Gỡ luôn kết nối" /
 * "Nối hàng loạt" (Q-23 "vẽ là khai, có hỏi", AD-18) — vẫn là endpoint của `devices`, cùng luật
 * một cổng một cáp (Q-20), và đường đọc `linksByIds` / `linksTouching` mà `diagrams` dùng.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'port-link@test';
const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;

describe('khai / gỡ / nối hàng loạt sợi dây', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let ports: DevicePortsService;
  let typeId: string;
  let cat6: string;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_link');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const registry = new DeviceRetirementRegistry();
    devices = new DevicesService(scratch.db, new CatalogApiService(new CatalogService(scratch.db, audit)), audit, registry, new DeviceSearchRegistry());
    new PortDeviceRetirement(registry, devices).onModuleInit();
    ports = new DevicePortsService(scratch.db, devices);
    typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E link') RETURNING id`)).rows[0].id;
    cat6 = (await scratch.pool.query<{ id: string }>(`SELECT id FROM cable_type WHERE name = 'Cat6'`)).rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function device(): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
      [`E2E-LINK-${seq}`, typeId],
    );
    return rows[0].id;
  }

  async function rowsOf(deviceId: string) {
    const { rows } = await scratch.pool.query<{ port_label: string; connected_device_id: string | null; connected_port: string | null; vlan: string | null }>(
      'SELECT port_label, connected_device_id, connected_port, vlan FROM device_port WHERE device_id = $1 ORDER BY port_label',
      [deviceId],
    );
    return rows;
  }

  it('khai dây mới: thêm dòng ở máy này, trả sợi dây kèm mã hai máy và loại dây', async () => {
    const sw = await device();
    const srv = await device();
    const link = await ports.link(actor, sw, { portLabel: 'Gi1/0/24', connectedDeviceId: srv, connectedPort: 'eth0', cableTypeId: cat6 });
    expect(link).toMatchObject({ deviceId: sw, portLabel: 'Gi1/0/24', peerDeviceId: srv, peerPort: 'eth0', cableTypeId: cat6 });
    expect(link.deviceCode).toMatch(/^E2E-LINK-/);
    expect(link.peerDeviceCode).toMatch(/^E2E-LINK-/);
    const { rows } = await scratch.pool.query<{ action: string }>('SELECT action FROM device_history WHERE device_id = $1', [sw]);
    expect(rows.map((r) => r.action)).toEqual(['port-added']);
  });

  it('cổng đã có dòng TRỐNG (chỉ VLAN) thì nối luôn dòng đó, không đẻ dòng thứ hai', async () => {
    const sw = await device();
    const pc = await device();
    await ports.create(actor, sw, { portLabel: 'Gi1/0/5', vlan: '20' });
    const link = await ports.link(actor, sw, { portLabel: 'gi1/0/5', connectedDeviceId: pc });
    expect(link.portLabel).toBe('Gi1/0/5');
    expect(await rowsOf(sw)).toEqual([{ port_label: 'Gi1/0/5', connected_device_id: pc, connected_port: null, vlan: '20' }]);
  });

  it('dòng trống nằm ở ĐẦU KIA thì nối dòng của đầu kia', async () => {
    const sw = await device();
    const pc = await device();
    await ports.create(actor, sw, { portLabel: 'Gi1/0/7', vlan: '30' });
    const link = await ports.link(actor, pc, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/7' });
    expect(link).toMatchObject({ deviceId: sw, portLabel: 'Gi1/0/7', peerDeviceId: pc, peerPort: 'eth0' });
    expect(await rowsOf(pc)).toEqual([]);
  });

  it('cổng đã có cáp → 409, không ghi gì', async () => {
    const sw = await device();
    const a = await device();
    const b = await device();
    await ports.link(actor, sw, { portLabel: 'Gi1/0/1', connectedDeviceId: a });
    await expect(ports.link(actor, sw, { portLabel: 'GI1/0/1', connectedDeviceId: b })).rejects.toMatchObject({
      response: { code: 'PORT_ALREADY_LINKED' },
    });
    await expect(ports.link(actor, b, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'gi1/0/1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(await rowsOf(b)).toEqual([]);
  });

  it('gỡ: dòng chỉ có dây thì xoá cả dòng; dòng còn VLAN thì giữ dòng, bỏ đầu kia', async () => {
    const sw = await device();
    const a = await device();
    const bare = await ports.link(actor, sw, { portLabel: 'Gi1/0/2', connectedDeviceId: a, cableTypeId: cat6 });
    expect(await ports.unlink(actor, sw, bare.id)).toEqual({ removed: true });
    await ports.create(actor, sw, { portLabel: 'Gi1/0/3', vlan: '10' });
    const kept = await ports.link(actor, sw, { portLabel: 'Gi1/0/3', connectedDeviceId: a, cableTypeId: cat6 });
    expect(await ports.unlink(actor, sw, kept.id)).toEqual({ removed: false });
    expect(await rowsOf(sw)).toEqual([{ port_label: 'Gi1/0/3', connected_device_id: null, connected_port: null, vlan: '10' }]);
    expect((await ports.linksByIds([bare.id, kept.id])).size).toBe(0);
  });

  it('nối hàng loạt: chia cổng theo thứ tự, bỏ qua cổng đã chiếm, dùng lại dòng trống', async () => {
    const sw = await device();
    const [a, b, c, busy] = [await device(), await device(), await device(), await device()];
    await ports.link(actor, sw, { portLabel: 'Gi1/0/2', connectedDeviceId: busy });
    await ports.create(actor, sw, { portLabel: 'Gi1/0/3', vlan: '20' });
    expect(await ports.bulkPlan(sw, { startPort: 'Gi1/0/1', count: 3 })).toEqual({
      ports: ['Gi1/0/1', 'Gi1/0/3', 'Gi1/0/4'],
      reason: null,
    });
    const links = await ports.bulkLink(actor, sw, { startPort: 'Gi1/0/1', targets: [a, b, c], cableTypeId: cat6 });
    expect(links.map((l) => [l.portLabel, l.peerDeviceId])).toEqual([
      ['Gi1/0/1', a],
      ['Gi1/0/3', b],
      ['Gi1/0/4', c],
    ]);
    expect((await rowsOf(sw)).find((r) => r.port_label === 'Gi1/0/3')?.vlan).toBe('20');
  });

  it('nối hàng loạt không đủ cổng → 400, KHÔNG ghi máy nào', async () => {
    const sw = await device();
    const [a, b] = [await device(), await device()];
    await ports.link(actor, sw, { portLabel: 'Gi1/0/2', connectedDeviceId: await device() });
    await expect(
      ports.bulkLink(actor, sw, { startPort: 'Gi1/0/1', endPort: 'Gi1/0/2', targets: [a, b] }),
    ).rejects.toMatchObject({ response: { code: 'BULK_LINK_INVALID' } });
    expect((await rowsOf(sw)).map((r) => r.port_label)).toEqual(['Gi1/0/2']);
  });

  it('nối hàng loạt vướng luật một cổng một cáp ở máy thứ hai → rollback cả lô', async () => {
    const sw = await device();
    const other = await device();
    const a = await device();
    const b = await device();
    await ports.link(actor, other, { portLabel: 'p1', connectedDeviceId: b, connectedPort: 'eth0' });
    await expect(
      ports.bulkLink(actor, sw, { startPort: 'Gi1/0/1', targets: [a, b], peerPort: 'eth0' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rowsOf(sw)).toEqual([]);
  });

  it('linksTouching: mọi dây chạm các máy đã cho, hai chiều', async () => {
    const sw = await device();
    const a = await device();
    const b = await device();
    const l1 = await ports.link(actor, sw, { portLabel: 'Gi1', connectedDeviceId: a });
    const l2 = await ports.link(actor, b, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi2' });
    const touching = await ports.linksTouching([sw]);
    expect(touching.map((l) => l.id).sort()).toEqual([l1.id, l2.id].sort());
    expect((await ports.linksTouching([a])).map((l) => l.id)).toEqual([l1.id]);
  });

  it('portUsage: cổng đang dùng / đã khai của từng máy, đếm cả dòng máy đầu kia giữ (thẻ máy trên sơ đồ)', async () => {
    const sw = await device();
    const a = await device();
    const quiet = await device();
    await ports.link(actor, sw, { portLabel: 'Gi1', connectedDeviceId: a, connectedPort: 'eth0' });
    await ports.link(actor, a, { portLabel: 'eth1', connectedDeviceId: sw, connectedPort: 'Gi2' });
    // Dòng chỉ ghi VLAN (cổng trống) và dòng nối thiết bị ngoài kho (chữ tự do).
    await scratch.pool.query(`INSERT INTO device_port (device_id, port_label, vlan) VALUES ($1, 'Gi3', '20')`, [sw]);
    await scratch.pool.query(`INSERT INTO device_port (device_id, port_label, connected_label) VALUES ($1, 'Gi4', 'Modem ISP')`, [sw]);
    const usage = await ports.portUsage([sw, a, quiet]);
    expect(usage.get(sw)).toEqual({ used: 3, declared: 4 });
    expect(usage.get(a)).toEqual({ used: 2, declared: 2 });
    expect(usage.get(quiet)).toEqual({ used: 0, declared: 0 });
  });
});

import { BadRequestException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { PortDeviceRetirement } from '../src/modules/devices/port-device-retirement';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-15 — lịch sử port map phải trả lời được "hôm đó cổng 12 cắm vào đâu, VLAN gì, ai dùng",
 * nên ghi đủ trước/sau của thiết bị đầu kia (MÃ), cổng đầu kia, VLAN, người dùng, ghi chú —
 * không chỉ tên cổng. Và không được cắm cổng sang một máy đã thanh lý.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'be15@test';

describe('BE-15 · lịch sử port map đủ thông tin; không cắm sang máy đã thanh lý', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let ports: DevicePortsService;
  let typeId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_history');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const registry = new DeviceRetirementRegistry();
    devices = new DevicesService(
      scratch.db,
      {} as CatalogApiService,
      audit,
      registry,
      new DeviceSearchRegistry(),
    );
    new PortDeviceRetirement(registry, devices).onModuleInit();
    ports = new DevicePortsService(scratch.db, devices);
    const type = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device_type (name) VALUES ('Switch BE-15') RETURNING id`,
    );
    typeId = type.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function device(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
      [code, typeId],
    );
    return rows[0].id;
  }

  async function history(deviceId: string): Promise<{ action: string; changes: unknown }[]> {
    const { rows } = await scratch.pool.query<{ action: string; changes: unknown }>(
      `SELECT action, changes FROM device_history WHERE device_id = $1 ORDER BY created_at, id`,
      [deviceId],
    );
    return rows;
  }

  it('thêm cổng ghi đủ các ô đã khai, đầu kia bằng MÃ thiết bị', async () => {
    const sw = await device('SW-H1');
    const pc = await device('PC-H1');
    await ports.create(actor, sw, {
      portLabel: 'Gi1/0/12',
      connectedDeviceId: pc,
      connectedPort: 'eth0',
      vlan: '20',
      usedBy: 'Kế toán',
      note: 'Dây xanh',
    });
    expect(await history(sw)).toEqual([
      {
        action: 'port-added',
        changes: {
          portLabel: { before: null, after: 'Gi1/0/12' },
          connectedDevice: { before: null, after: 'PC-H1' },
          connectedPort: { before: null, after: 'eth0' },
          vlan: { before: null, after: '20' },
          usedBy: { before: null, after: 'Kế toán' },
          note: { before: null, after: 'Dây xanh' },
        },
      },
    ]);
  });

  it('sửa cổng ghi trước/sau của các ô đổi, kèm tên cổng để câu lịch sử nêu được cổng nào', async () => {
    const sw = await device('SW-H2');
    const pcA = await device('PC-H2A');
    const pcB = await device('PC-H2B');
    const port = await ports.create(actor, sw, {
      portLabel: 'Gi1/0/3',
      connectedDeviceId: pcA,
      vlan: '10',
    });
    await ports.update(actor, sw, port.id, {
      portLabel: 'Gi1/0/3',
      connectedDeviceId: pcB,
      connectedLabel: '',
      connectedPort: 'eth1',
      usedBy: '',
      vlan: 'trunk',
      note: '',
    });
    const rows = await history(sw);
    expect(rows[1]).toEqual({
      action: 'port-updated',
      changes: {
        portLabel: { before: 'Gi1/0/3', after: 'Gi1/0/3' },
        connectedDevice: { before: 'PC-H2A', after: 'PC-H2B' },
        connectedPort: { before: null, after: 'eth1' },
        vlan: { before: '10', after: 'trunk' },
      },
    });
  });

  it('gỡ cổng ghi lại đầu kia đã cắm vào đâu', async () => {
    const sw = await device('SW-H3');
    const pc = await device('PC-H3');
    const port = await ports.create(actor, sw, {
      portLabel: 'Gi1/0/4',
      connectedDeviceId: pc,
      connectedPort: 'eth0',
    });
    await ports.remove(actor, sw, port.id);
    const rows = await history(sw);
    expect(rows[1]).toEqual({
      action: 'port-removed',
      changes: {
        portLabel: { before: 'Gi1/0/4', after: null },
        connectedDevice: { before: 'PC-H3', after: null },
        connectedPort: { before: 'eth0', after: null },
      },
    });
  });

  async function badCode(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return ((error as BadRequestException).getResponse() as { code?: string }).code;
    }
  }

  it('thêm hay sửa cổng cắm sang máy đã thanh lý thì 400 PORT_PEER_RETIRED, không ghi gì', async () => {
    const sw = await device('SW-H4');
    const old = await device('PC-H4-OLD');
    await devices.setStatus(actor, old, 'retired');

    expect(
      await badCode(ports.create(actor, sw, { portLabel: 'Gi1/0/5', connectedDeviceId: old })),
    ).toBe('PORT_PEER_RETIRED');

    const port = await ports.create(actor, sw, { portLabel: 'Gi1/0/6' });
    expect(
      await badCode(ports.update(actor, sw, port.id, { connectedDeviceId: old })),
    ).toBe('PORT_PEER_RETIRED');

    const { rows } = await scratch.pool.query(
      `SELECT port_label, connected_device_id FROM device_port WHERE device_id = $1`,
      [sw],
    );
    expect(rows).toEqual([{ port_label: 'Gi1/0/6', connected_device_id: null }]);
  });
});

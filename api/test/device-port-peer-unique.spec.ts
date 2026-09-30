import { ConflictException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { PortDeviceRetirement } from '../src/modules/devices/port-device-retirement';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';

/**
 * OLD-DB-02 (AD-14) — một cổng đầu kia chỉ được một dòng port map ghi đấu vào.
 *
 * `device_port_label_key` chỉ giữ đầu GHI; `device_port_peer_port_key` giữ đầu KIA, để hai máy
 * khác nhau không cùng khai "đấu vào SW-01 cổng 24". Dòng của máy đã thanh lý thì không tính:
 * nó bị khoá không gỡ được, nếu vẫn chiếm cổng thì máy thay thế không bao giờ khai được vào
 * đúng lỗ cắm đó.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'olddb02@test';

describe('OLD-DB-02 · device_port không cho hai dòng cùng đấu vào một cổng', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let ports: DevicePortsService;
  let typeId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_peer');
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
      `INSERT INTO device_type (name) VALUES ('Switch OLD-DB-02') RETURNING id`,
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

  async function conflictCode(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return ((error as ConflictException).getResponse() as { code?: string }).code;
    }
  }

  it('dòng thứ hai đấu vào cùng cổng bị từ chối bằng 409 PORT_PEER_TAKEN', async () => {
    const sw = await device('SW-A');
    const s1 = await device('SRV-A1');
    const s2 = await device('SRV-A2');
    await ports.create(actor, s1, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/24' });

    expect(
      await conflictCode(
        ports.create(actor, s2, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/24' }),
      ),
    ).toBe('PORT_PEER_TAKEN');

    // Sửa một dòng khác thành đúng cổng đó cũng bị chặn.
    const other = await ports.create(actor, s2, {
      portLabel: 'eth0',
      connectedDeviceId: sw,
      connectedPort: 'Gi1/0/23',
    });
    expect(
      await conflictCode(ports.update(actor, s2, other.id, { connectedPort: 'Gi1/0/24' })),
    ).toBe('PORT_PEER_TAKEN');
  });

  it('trùng tên cổng ở đầu ghi vẫn ra PORT_LABEL_TAKEN, không lẫn sang khoá mới', async () => {
    const sw = await device('SW-B');
    await ports.create(actor, sw, { portLabel: 'Gi1/0/1' });
    // Chèn thẳng để đi qua được bước kiểm sớm của service và chạm tới DB.
    await expect(
      scratch.pool.query(`INSERT INTO device_port (device_id, port_label) VALUES ($1, 'Gi1/0/1')`, [sw]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'device_port_label_key' });
  });

  it('chiều ngược mang VLAN của cổng switch đang cắm vào máy này', async () => {
    const sw = await device('SW-VLAN');
    const pc = await device('PC-VLAN');
    await ports.create(actor, sw, { portLabel: 'Gi1/0/7', connectedDeviceId: pc, vlan: '20' });
    const map = await ports.listFor(pc);
    expect(map.incoming).toEqual([expect.objectContaining({ portLabel: 'Gi1/0/7', vlan: '20' })]);
  });

  it('không biết cổng đầu kia, hoặc đầu kia chỉ là chữ, thì không bị ràng buộc', async () => {
    const sw = await device('SW-C');
    const a = await device('PC-C1');
    const b = await device('PC-C2');
    await ports.create(actor, a, { portLabel: 'eth0', connectedDeviceId: sw });
    await ports.create(actor, b, { portLabel: 'eth0', connectedDeviceId: sw });
    await ports.create(actor, a, { portLabel: 'eth1', connectedLabel: 'Máy in', connectedPort: '1' });
    await ports.create(actor, b, { portLabel: 'eth1', connectedLabel: 'Máy in', connectedPort: '1' });
  });

  it('dòng của máy đã thanh lý nhả cổng cho máy thay thế; mở lại máy cũ khi cổng đã bị chiếm thì 409', async () => {
    const sw = await device('SW-D');
    const oldSrv = await device('SRV-D-OLD');
    const newSrv = await device('SRV-D-NEW');
    await ports.create(actor, oldSrv, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/5' });

    await devices.setStatus(actor, oldSrv, 'retired');
    await ports.create(actor, newSrv, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/5' });

    // Dòng của máy cũ vẫn còn nguyên — bằng chứng "hồi đó nó cắm vào đâu".
    const kept = await scratch.pool.query(
      `SELECT connected_port FROM device_port WHERE device_id = $1`,
      [oldSrv],
    );
    expect(kept.rows).toEqual([{ connected_port: 'Gi1/0/5' }]);

    expect(await conflictCode(devices.setStatus(actor, oldSrv, 'in_use'))).toBe('PORT_PEER_TAKEN');
    const status = await scratch.pool.query(`SELECT status FROM device WHERE id = $1`, [oldSrv]);
    expect(status.rows[0].status).toBe('retired');
  });

  it('mở lại máy đã thanh lý khi cổng còn trống thì dòng cũ giữ lại cổng', async () => {
    const sw = await device('SW-E');
    const srv = await device('SRV-E');
    const intruder = await device('SRV-E-2');
    await ports.create(actor, srv, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: '7' });
    await devices.setStatus(actor, srv, 'retired');
    await devices.setStatus(actor, srv, 'spare');
    expect(
      await conflictCode(
        ports.create(actor, intruder, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: '7' }),
      ),
    ).toBe('PORT_PEER_TAKEN');
  });

  it('không tin cờ owner_retired do người ghi tự đặt', async () => {
    const sw = await device('SW-F');
    const a = await device('SRV-F1');
    const b = await device('SRV-F2');
    await ports.create(actor, a, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: '9' });
    await expect(
      scratch.pool.query(
        `INSERT INTO device_port (device_id, port_label, connected_device_id, connected_port, owner_retired)
         VALUES ($1, 'eth0', $2, '9', true)`,
        [b, sw],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'device_port_peer_port_key' });
  });
});

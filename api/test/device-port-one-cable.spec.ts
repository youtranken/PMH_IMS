import { ConflictException } from '@nestjs/common';
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
 * Q-20 — sơ đồ cổng: mỗi cổng chỉ MỘT sợi cáp, kiểm cả hai chiều, tên cổng không phân biệt
 * hoa/thường. X:p1→Y:g1 thì Y:g1 không nối sang máy nào khác (trừ chính dòng ngược Y:g1→X:p1,
 * cùng một sợi), và không dòng nào khác được nối vào Y:g1.
 */

const TEST_TIMEOUT = 120_000;
const actor = 'g2-61@test';

describe('G2-61 · một cổng một sợi cáp', () => {
  let scratch: ScratchDb;
  let devices: DevicesService;
  let ports: DevicePortsService;
  let typeId: string;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_one_cable');
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
      `INSERT INTO device_type (name) VALUES ('Switch E2E G2-61') RETURNING id`,
    );
    typeId = type.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function device(prefix: string): Promise<string> {
    seq += 1;
    const code = `E2E-${prefix}-${seq}`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
      [code, typeId],
    );
    return rows[0].id;
  }

  async function codeOf(id: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ code: string }>(
      'SELECT code FROM device WHERE id = $1',
      [id],
    );
    return rows[0].code;
  }

  async function conflict(p: Promise<unknown>): Promise<{ code?: string; message?: string } | undefined> {
    try {
      await p;
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse() as { code?: string; message?: string };
    }
  }

  it('tên cổng trùng khác hoa/thường trên cùng máy → 409 PORT_LABEL_TAKEN', async () => {
    const sw = await device('SW');
    await ports.create(actor, sw, { portLabel: 'Gi1/0/1' });
    const err = await conflict(ports.create(actor, sw, { portLabel: 'gi1/0/1' }));
    expect(err?.code).toBe('PORT_LABEL_TAKEN');
    expect(err?.message).toContain('Gi1/0/1');
    // DB cũng chặn, kể cả khi đi vòng qua service.
    await expect(
      scratch.pool.query(`INSERT INTO device_port (device_id, port_label) VALUES ($1, 'GI1/0/1')`, [sw]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'device_port_label_key' });
  });

  it('hai dòng nối vào cùng cổng đầu kia khác hoa/thường → 409 PORT_PEER_TAKEN, nêu tên cổng', async () => {
    const sw = await device('SW');
    const a = await device('SRV');
    const b = await device('SRV');
    await ports.create(actor, a, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'Gi1/0/24' });
    const err = await conflict(
      ports.create(actor, b, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: 'gi1/0/24' }),
    );
    expect(err?.code).toBe('PORT_PEER_TAKEN');
    expect(err?.message).toContain('Gi1/0/24');
    expect(err?.message).toContain(await codeOf(a));
    await expect(
      scratch.pool.query(
        `INSERT INTO device_port (device_id, port_label, connected_device_id, connected_port)
         VALUES ($1, 'eth9', $2, 'GI1/0/24')`,
        [b, sw],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'device_port_peer_port_key' });
  });

  it('X:p1→Y:g1 rồi khai Y:g1 nối sang máy khác → 409, nêu cổng và máy đang giữ', async () => {
    const x = await device('X');
    const y = await device('Y');
    const z = await device('Z');
    await ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'g1' });
    const err = await conflict(
      ports.create(actor, y, { portLabel: 'G1', connectedDeviceId: z, connectedPort: 'q1' }),
    );
    expect(err?.code).toBe('PORT_ALREADY_LINKED');
    expect(err?.message).toContain('G1');
    expect(err?.message).toContain(await codeOf(x));
    expect(err?.message).toContain('p1');
  });

  it('Y:g1 đã nối sang Z rồi khai X:p1→Y:g1 → 409 (chiều kia)', async () => {
    const x = await device('X');
    const y = await device('Y');
    const z = await device('Z');
    await ports.create(actor, y, { portLabel: 'g1', connectedDeviceId: z, connectedPort: 'q1' });
    const err = await conflict(
      ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'G1' }),
    );
    expect(err?.code).toBe('PORT_PEER_TAKEN');
    expect(err?.message).toContain('g1');
    expect(err?.message).toContain(await codeOf(z));
  });

  it('sửa một dòng sẵn có thành nối vào cổng đã có cáp → 409', async () => {
    const x = await device('X');
    const y = await device('Y');
    const z = await device('Z');
    await ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'g1' });
    const free = await ports.create(actor, y, { portLabel: 'g1' });
    const err = await conflict(
      ports.update(actor, y, free.id, { connectedDeviceId: z, connectedPort: 'q1' }),
    );
    expect(err?.code).toBe('PORT_ALREADY_LINKED');
  });

  it('được phép: dòng ngược của CÙNG sợi cáp, cổng chỉ ghi mô tả, đầu kia không rõ cổng hoặc chỉ là chữ', async () => {
    const x = await device('X');
    const y = await device('Y');
    await ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'g1' });
    // Cùng một sợi nhìn từ phía Y.
    await ports.create(actor, y, { portLabel: 'G1', connectedDeviceId: x, connectedPort: 'P1' });

    const sw = await device('SW');
    const pc = await device('PC');
    await ports.create(actor, pc, { portLabel: 'eth0', connectedDeviceId: sw, connectedPort: '5' });
    // Cổng 5 của switch chỉ ghi VLAN + người dùng — không phải sợi cáp thứ hai.
    await ports.create(actor, sw, { portLabel: '5', vlan: '20', usedBy: 'Phòng E2E' });
    // Đầu kia không rõ cổng: không chiếm cổng nào.
    await ports.create(actor, pc, { portLabel: 'eth1', connectedDeviceId: sw });
    // Cổng ghi chữ (máy chưa có hồ sơ) không chặn máy có hồ sơ cắm vào.
    await ports.create(actor, sw, { portLabel: '6', connectedLabel: 'Máy in E2E' });
    const printer = await device('PRN');
    await ports.create(actor, printer, { portLabel: 'lan', connectedDeviceId: sw, connectedPort: '6' });
  });

  it('dòng của máy đã thanh lý không giữ cổng', async () => {
    const x = await device('X');
    const y = await device('Y');
    const z = await device('Z');
    await ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'g1' });
    await devices.setStatus(actor, x, 'retired');
    await ports.create(actor, y, { portLabel: 'g1', connectedDeviceId: z, connectedPort: 'q1' });
  });

  it('RACE: hai lượt ghi hai chiều của cùng một cổng chạy song song → đúng một lượt thành', async () => {
    for (let round = 0; round < 8; round += 1) {
      const x = await device('X');
      const y = await device('Y');
      const z = await device('Z');
      const results = await Promise.allSettled([
        ports.create(actor, x, { portLabel: 'p1', connectedDeviceId: y, connectedPort: 'g1' }),
        ports.create(actor, y, { portLabel: 'g1', connectedDeviceId: z, connectedPort: 'q1' }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      expect(ok).toBe(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
    }
  });
});

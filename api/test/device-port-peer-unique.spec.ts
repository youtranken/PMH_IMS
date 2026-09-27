import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { PortDeviceRetirement } from '../src/modules/devices/port-device-retirement';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * OLD-DB-02 (AD-14) — một cổng đầu kia chỉ được một dòng port map ghi đấu vào.
 *
 * Trước 0070 chỉ có `device_port_label_key` (đầu ghi), nên hai máy khác nhau cùng khai "đấu
 * vào SW-01 cổng 24" được. Dòng của máy đã thanh lý thì không tính: nó bị khoá không gỡ được,
 * nếu vẫn chiếm cổng thì máy thay thế không bao giờ khai được vào đúng lỗ cắm đó.
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
    devices = new DevicesService(scratch.db, {} as CatalogApiService, audit, registry);
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

  it('migration dừng với danh sách dòng trùng khi dữ liệu cũ đã vi phạm', async () => {
    const legacy = await createScratchDb('ims_port_peer_legacy');
    try {
      const dir = migrationsDir();
      const upTo = await legacyDirWithout0070(dir);
      await runMigrations(legacy.pool, upTo, { log: () => undefined });
      const t = await legacy.pool.query<{ id: string }>(
        `INSERT INTO device_type (name) VALUES ('Switch OLD-DB-02') RETURNING id`,
      );
      const ids: string[] = [];
      for (const code of ['SW-L', 'SRV-L1', 'SRV-L2']) {
        const r = await legacy.pool.query<{ id: string }>(
          `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
          [code, t.rows[0].id],
        );
        ids.push(r.rows[0].id);
      }
      for (const owner of [ids[1], ids[2]]) {
        await legacy.pool.query(
          `INSERT INTO device_port (device_id, port_label, connected_device_id, connected_port)
           VALUES ($1, 'eth0', $2, 'Gi1/0/24')`,
          [owner, ids[0]],
        );
      }
      const sql = readFileSync(join(dir, '0070_device_port_peer_port_unique.sql'), 'utf8');
      await expect(legacy.pool.query(sql)).rejects.toThrow(/SW-L cổng Gi1\/0\/24 ← SRV-L1\/eth0 .*SRV-L2\/eth0/);
    } finally {
      await legacy.drop();
    }
  }, TEST_TIMEOUT);
});

/** Thư mục tạm chứa mọi migration TRƯỚC 0070 — dựng đúng DB như lúc chưa có khoá mới. */
async function legacyDirWithout0070(dir: string): Promise<string> {
  const { mkdtempSync, readdirSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const out = mkdtempSync(join(tmpdir(), 'ims-mig-'));
  for (const name of readdirSync(dir)) {
    if (/^\d{4}_.+\.sql$/.test(name) && name < '0070') copyFileSync(join(dir, name), join(out, name));
  }
  return out;
}

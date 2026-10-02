import { runMigrations } from '../src/database/migration-runner';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import type { DevicesService } from '../src/modules/devices/devices.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * OLD-DB-04 — `device_port.vlan` chỉ nhận số 1–4094 hoặc "trunk" (Q-16): DB tự chặn, còn cửa
 * ghi của service trả mã lỗi đọc được thay vì 500. IP WAN của đường truyền: xem
 * `isp-wan-ips.spec.ts` (bảng `isp_line_wan_ip`, Q-20).
 */

const TEST_TIMEOUT = 120_000;

async function seedDevice(pool: ScratchDb['pool'], code: string): Promise<string> {
  const type = await pool.query<{ id: string }>(
    `INSERT INTO device_type (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['Switch OLD-DB-04'],
  );
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO device (code, name, device_type_id) VALUES ($1::text, $1::text, $2) RETURNING id`,
    [code, type.rows[0].id],
  );
  return rows[0].id;
}

describe('OLD-DB-04 · DB trắng', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_olddb04_blank');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('cửa ghi port map: VLAN sai là 400 PORT_VLAN_INVALID, "Trunk" lưu thành "trunk"', async () => {
    const dev = await seedDevice(scratch.pool, 'SW-OLDDB04-SVC');
    const ports = new DevicePortsService(scratch.db, {
      assertUsableWithin: () => Promise.resolve(),
      recordWithin: () => Promise.resolve(),
    } as unknown as DevicesService);
    await expect(
      ports.create('olddb04@test', dev, { portLabel: 'Gi1/0/1', vlan: 'VLAN20' }),
    ).rejects.toMatchObject({ response: { code: 'PORT_VLAN_INVALID' } });
    const port = await ports.create('olddb04@test', dev, { portLabel: 'Gi1/0/2', vlan: ' Trunk ' });
    expect(port.vlan).toBe('trunk');
  });

  it('isp_line_search_norm_trgm có mặt trên cột sinh', async () => {
    const { rows } = await scratch.pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'isp_line_search_norm_trgm'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('device_port.vlan chỉ nhận số 1–4094 hoặc "trunk"', async () => {
    const dev = await seedDevice(scratch.pool, 'SW-OLDDB04');
    const insert = (label: string, vlan: string | null) =>
      scratch.pool.query(`INSERT INTO device_port (device_id, port_label, vlan) VALUES ($1, $2, $3)`, [
        dev,
        label,
        vlan,
      ]);
    for (const [i, ok] of [null, '1', '20', '4094', 'trunk'].entries()) {
      await expect(insert(`ok-${i}`, ok)).resolves.toBeTruthy();
    }
    for (const [i, bad] of ['0', '4095', '020', 'VLAN20', 'Trunk', '10,20', ''].entries()) {
      await expect(insert(`bad-${i}`, bad)).rejects.toMatchObject({
        code: '23514',
        constraint: 'device_port_vlan_check',
      });
    }
  });
});

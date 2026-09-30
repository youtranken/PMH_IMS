import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import type { DevicesService } from '../src/modules/devices/devices.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * OLD-DB-04 — `isp_line.wan_ip` là `inet` (Q-04), `device_port.vlan` chỉ nhận số 1–4094 hoặc
 * "trunk" (Q-16): DB tự chặn, còn cửa ghi của service trả mã lỗi đọc được thay vì 500.
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

  it('isp_line.wan_ip là inet; ô tìm vẫn thấy IP đúng như màn hình in', async () => {
    const col = await scratch.pool.query<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns
        WHERE table_name = 'isp_line' AND column_name = 'wan_ip'`,
    );
    expect(col.rows[0].udt_name).toBe('inet');

    const p = await seedIspProviders(scratch.pool, ['FPT OLD-DB-04']);
    await scratch.pool.query(
      `INSERT INTO isp_line (code, provider, provider_id, wan_ip) VALUES
         ('WAN-HOST', 'FPT OLD-DB-04', $1, '203.0.113.10'),
         ('WAN-BLOCK', 'FPT OLD-DB-04', $1, '113.161.20.16/29')`,
      [p['FPT OLD-DB-04']],
    );
    const { rows } = await scratch.pool.query<{ code: string; wan_ip: string; search_norm: string }>(
      `SELECT code::text AS code, wan_ip, search_norm FROM isp_line ORDER BY code`,
    );
    expect(rows.map((r) => [r.code, r.wan_ip])).toEqual([
      ['WAN-BLOCK', '113.161.20.16/29'],
      ['WAN-HOST', '203.0.113.10'],
    ]);
    // `/32` không lọt vào khoá tìm: gõ đúng thứ màn hình in thì phải ra.
    expect(rows[1].search_norm).toContain('203.0.113.10');
    expect(rows[1].search_norm).not.toContain('/32');
    expect(rows[0].search_norm).toContain('113.161.20.16/29');

    await expect(
      scratch.pool.query(
        `INSERT INTO isp_line (code, provider, provider_id, wan_ip) VALUES ('WAN-BAD', 'FPT OLD-DB-04', $1, 'động')`,
        [p['FPT OLD-DB-04']],
      ),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('cửa ghi đường truyền: IP sai là 400 WAN_IP_INVALID, "/32" lưu thành địa chỉ trần', async () => {
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
    const isp = new IspLineService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, audit)),
      devices,
      audit,
    );
    const p = await seedIspProviders(scratch.pool, ['CMC OLD-DB-04']);
    const providerId = p['CMC OLD-DB-04'];

    await expect(
      isp.create('olddb04@test', { code: 'SVC-BAD', providerId, wanIp: 'động' }),
    ).rejects.toMatchObject({ response: { code: 'WAN_IP_INVALID' } });

    const line = await isp.create('olddb04@test', { code: 'SVC-32', providerId, wanIp: '203.0.113.9/32' });
    expect(line.wanIp).toBe('203.0.113.9');
    const cleared = await isp.update('olddb04@test', line.id, { wanIp: '' });
    expect(cleared.wanIp).toBeNull();
  });

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

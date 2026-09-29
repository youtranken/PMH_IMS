import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * OLD-DB-04 — `isp_line.wan_ip` thành `inet`, `device_port.vlan` có CHECK.
 *
 * Hai migration đổi dữ liệu ĐÃ CÓ, nên mỗi cái được kiểm theo cả ba đường: DB trắng, DB có
 * dữ liệu hợp lệ (phải giữ nguyên giá trị), và DB có dữ liệu sai (phải dừng và nói rõ dòng
 * nào sai, không để Postgres ném một câu ép kiểu vô dụng với người trực).
 */

const TEST_TIMEOUT = 120_000;
const WAN = '0300_isp_line_wan_ip_inet.sql';
const VLAN = '0301_device_port_vlan_check.sql';

/** Thư mục tạm chứa mọi migration đứng TRƯỚC `first` — dựng đúng DB như lúc chưa có nó. */
function dirBefore(first: string): string {
  const out = mkdtempSync(join(tmpdir(), 'ims-mig-before-0300-'));
  for (const name of readdirSync(migrationsDir())) {
    if (/^\d{4}_.+\.sql$/.test(name) && name < first) {
      copyFileSync(join(migrationsDir(), name), join(out, name));
    }
  }
  return out;
}

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

  it('isp_line_search_norm_trgm vẫn còn sau khi dựng lại cột sinh', async () => {
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

describe('OLD-DB-04 · DB đã có dữ liệu hợp lệ', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_olddb04_legacy');
    await runMigrations(scratch.pool, dirBefore(WAN), { log: () => undefined });
    const p = await seedIspProviders(scratch.pool, ['VNPT OLD-DB-04']);
    await scratch.pool.query(
      `INSERT INTO isp_line (code, provider, provider_id, wan_ip) VALUES
         ('MIG-HOST', 'VNPT OLD-DB-04', $1, '14.160.1.2'),
         ('MIG-PAD', 'VNPT OLD-DB-04', $1, '  14.160.1.3 '),
         ('MIG-BLOCK', 'VNPT OLD-DB-04', $1, '113.161.20.16/29'),
         ('MIG-EMPTY', 'VNPT OLD-DB-04', $1, '   '),
         ('MIG-NULL', 'VNPT OLD-DB-04', $1, NULL)`,
      [p['VNPT OLD-DB-04']],
    );
    const dev = await seedDevice(scratch.pool, 'SW-MIG');
    await scratch.pool.query(
      `INSERT INTO device_port (device_id, port_label, vlan) VALUES
         ($1, 'p1', '20'), ($1, 'p2', ' 30 '), ($1, 'p3', 'Trunk'), ($1, 'p4', ''), ($1, 'p5', NULL)`,
      [dev],
    );
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('IP WAN giữ nguyên giá trị, khoảng trắng thừa bị bỏ, ô trắng thành NULL', async () => {
    const { rows } = await scratch.pool.query<{ code: string; wan_ip: string | null }>(
      `SELECT code::text AS code, wan_ip FROM isp_line ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'MIG-BLOCK', wan_ip: '113.161.20.16/29' },
      { code: 'MIG-EMPTY', wan_ip: null },
      { code: 'MIG-HOST', wan_ip: '14.160.1.2' },
      { code: 'MIG-NULL', wan_ip: null },
      { code: 'MIG-PAD', wan_ip: '14.160.1.3' },
    ]);
  });

  it('VLAN cổng được chuẩn hoá về dạng CHECK nhận', async () => {
    const { rows } = await scratch.pool.query<{ port_label: string; vlan: string | null }>(
      `SELECT port_label, vlan FROM device_port ORDER BY port_label`,
    );
    expect(rows).toEqual([
      { port_label: 'p1', vlan: '20' },
      { port_label: 'p2', vlan: '30' },
      { port_label: 'p3', vlan: 'trunk' },
      { port_label: 'p4', vlan: null },
      { port_label: 'p5', vlan: null },
    ]);
  });
});

describe('OLD-DB-04 · DB có dữ liệu sai thì migration dừng và kể tên dòng sai', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_olddb04_bad');
    await runMigrations(scratch.pool, dirBefore(WAN), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('IP WAN không phải địa chỉ: báo mã đường truyền và giá trị, không đổi gì', async () => {
    const p = await seedIspProviders(scratch.pool, ['Viettel OLD-DB-04']);
    await scratch.pool.query(
      `INSERT INTO isp_line (code, provider, provider_id, wan_ip) VALUES
         ('BAD-DONG', 'Viettel OLD-DB-04', $1, 'động'),
         ('BAD-RANGE', 'Viettel OLD-DB-04', $1, '1.2.3.4 - 1.2.3.9'),
         ('GOOD', 'Viettel OLD-DB-04', $1, '1.2.3.4')`,
      [p['Viettel OLD-DB-04']],
    );
    const sql = readFileSync(join(migrationsDir(), WAN), 'utf8');
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(sql)).rejects.toThrow(
        /BAD-DONG: "động"[\s\S]*BAD-RANGE: "1\.2\.3\.4 - 1\.2\.3\.9"/,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const col = await scratch.pool.query<{ udt_name: string }>(
      `SELECT udt_name FROM information_schema.columns
        WHERE table_name = 'isp_line' AND column_name = 'wan_ip'`,
    );
    expect(col.rows[0].udt_name).toBe('text');
  });

  it('VLAN cổng không đọc được: báo thiết bị, cổng và giá trị', async () => {
    const dev = await seedDevice(scratch.pool, 'SW-BAD');
    await scratch.pool.query(
      `INSERT INTO device_port (device_id, port_label, vlan) VALUES
         ($1, 'Gi1/0/1', 'VLAN20'), ($1, 'Gi1/0/2', '5000'), ($1, 'Gi1/0/3', '20')`,
      [dev],
    );
    const sql = readFileSync(join(migrationsDir(), VLAN), 'utf8');
    await expect(scratch.pool.query(sql)).rejects.toThrow(
      /SW-BAD cổng Gi1\/0\/1: "VLAN20"[\s\S]*SW-BAD cổng Gi1\/0\/2: "5000"/,
    );
  });
});

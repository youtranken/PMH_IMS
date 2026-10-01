import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ensureAppRole } from '../src/database/app-role';
import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import {
  appDbPassword,
  appDbUrl,
  createScratchDb,
  migrationsDir,
  seedIspProviders,
  testDbUrl,
  waitForLock,
  type ScratchDb,
} from './db';

/**
 * Q-20 (sửa Q-04): một đường truyền có NHIỀU IP WAN, mỗi IP một hàng ở `isp_line_wan_ip`.
 * Chỉ IPv4 đơn — nhà mạng cấp từng IP, không cấp dải.
 */

const TEST_TIMEOUT = 120_000;
const WAN_MIGRATION = '0042_isp_line_wan_ip.sql';

function serviceOn(scratch: ScratchDb): IspLineService {
  const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
  const devices = { getByIds: () => Promise.resolve(new Map()) } as unknown as DevicesApiService;
  return new IspLineService(
    scratch.db,
    new CatalogApiService(new CatalogService(scratch.db, audit)),
    devices,
    audit,
  );
}

describe('isp_line_wan_ip · chuyển dữ liệu cũ', () => {
  let scratch: ScratchDb;
  let dir: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_wanips_carry');
    // Dựng DB tới NGAY TRƯỚC file mới, gieo dữ liệu theo dạng cũ (một cột `wan_ip`), rồi mới
    // chạy cả bộ: đúng cảnh một DB đang có đường truyền nhận bản này.
    dir = await mkdtemp(join(tmpdir(), 'ims-wanips-'));
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((name) => name < WAN_MIGRATION)) {
      await copyFile(join(migrationsDir(), f), join(dir, f));
    }
    await runMigrations(scratch.pool, dir, { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    'IP đang có chuyển sang bảng mới; dải cũ giữ lại địa chỉ; cột wan_ip biến mất',
    async () => {
      const p = await seedIspProviders(scratch.pool, ['FPT E2E-WAN-CARRY']);
      await scratch.pool.query(
        `INSERT INTO isp_line (code, provider, provider_id, wan_ip) VALUES
           ('E2E-WAN-ONE', 'FPT E2E-WAN-CARRY', $1, '203.0.113.10'),
           ('E2E-WAN-BLOCK', 'FPT E2E-WAN-CARRY', $1, '113.161.20.17/29'),
           ('E2E-WAN-NONE', 'FPT E2E-WAN-CARRY', $1, NULL)`,
        [p['FPT E2E-WAN-CARRY']],
      );

      const applied = await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
      expect(applied).toContain(WAN_MIGRATION);

      const { rows } = await scratch.pool.query<{ code: string; ip: string }>(
        `SELECT l.code::text AS code, host(w.address) AS ip
           FROM isp_line_wan_ip w JOIN isp_line l ON l.id = w.isp_line_id
          ORDER BY l.code`,
      );
      expect(rows).toEqual([
        { code: 'E2E-WAN-BLOCK', ip: '113.161.20.17' },
        { code: 'E2E-WAN-ONE', ip: '203.0.113.10' },
      ]);

      const col = await scratch.pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'isp_line' AND column_name = 'wan_ip'`,
      );
      expect(col.rows).toHaveLength(0);

      // Cột tìm kiếm được dựng lại trên các trường còn lại, chỉ mục GIN vẫn đứng.
      const norm = await scratch.pool.query<{ search_norm: string }>(
        `SELECT search_norm FROM isp_line WHERE code = 'E2E-WAN-ONE'`,
      );
      expect(norm.rows[0].search_norm).toContain('e2e-wan-one');
      const idx = await scratch.pool.query(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'isp_line_search_norm_trgm'`,
      );
      expect(idx.rows).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );
});

describe('isp_line_wan_ip · DB trắng', () => {
  let scratch: ScratchDb;
  let isp: IspLineService;
  let providerId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_wanips_blank');
    await ensureAppRole(scratch.pool, 'ims_app', appDbPassword());
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    isp = serviceOn(scratch);
    providerId = (await seedIspProviders(scratch.pool, ['VNPT E2E-WAN']))['VNPT E2E-WAN'];
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('DB chỉ nhận IPv4 đơn; cùng một đường không lặp IP, hai đường thì được', async () => {
    const a = await isp.create('wan@test', { code: 'E2E-WAN-DB-A', providerId });
    const b = await isp.create('wan@test', { code: 'E2E-WAN-DB-B', providerId });
    const insert = (lineId: string, ip: string, order: number) =>
      scratch.pool.query(
        `INSERT INTO isp_line_wan_ip (isp_line_id, address, sort_order) VALUES ($1, $2, $3)`,
        [lineId, ip, order],
      );
    await insert(a.id, '203.0.113.20', 0);
    await insert(b.id, '203.0.113.20', 0);
    await expect(insert(a.id, '203.0.113.20/32', 1)).rejects.toMatchObject({ code: '23505' });
    await expect(insert(a.id, '203.0.113.24/29', 1)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(a.id, '2001:db8::1', 1)).rejects.toMatchObject({ code: '23514' });
  });

  it('ghi qua service: nhiều IP, giữ thứ tự, lọc trùng; đọc lại đủ ở chi tiết và danh sách', async () => {
    const line = await isp.create('wan@test', {
      code: 'E2E-WAN-MULTI',
      providerId,
      wanIps: ['113.161.10.21', '113.161.10.20', '113.161.10.21'],
    });
    expect(line.wanIps).toEqual(['113.161.10.21', '113.161.10.20']);
    expect((await isp.findOne(line.id)).wanIps).toEqual(['113.161.10.21', '113.161.10.20']);
    const page = await isp.list({ page: 1, limit: 50 }, { search: 'E2E-WAN-MULTI' });
    expect(page.items.map((r) => r.wanIps)).toEqual([['113.161.10.21', '113.161.10.20']]);
  });

  it('dải hoặc chữ lạ là 400 đọc được, không ghi gì', async () => {
    await expect(
      isp.create('wan@test', { code: 'E2E-WAN-RANGE', providerId, wanIps: ['113.161.10.16/29'] }),
    ).rejects.toMatchObject({ response: { code: 'WAN_IP_RANGE' } });
    await expect(
      isp.create('wan@test', { code: 'E2E-WAN-BAD', providerId, wanIps: ['động'] }),
    ).rejects.toMatchObject({ response: { code: 'WAN_IP_INVALID' } });
    const { rows } = await scratch.pool.query(
      `SELECT 1 FROM isp_line WHERE code IN ('E2E-WAN-RANGE', 'E2E-WAN-BAD')`,
    );
    expect(rows).toHaveLength(0);
  });

  it('tìm theo BẤT KỲ IP nào của đường (danh sách và Ctrl+K cùng dùng `?search=`)', async () => {
    const line = await isp.create('wan@test', {
      code: 'E2E-WAN-SEARCH',
      providerId,
      wanIps: ['198.51.100.7', '198.51.100.99'],
    });
    for (const term of ['198.51.100.7', '198.51.100.99', '100.99']) {
      const page = await isp.list({ page: 1, limit: 50 }, { search: term });
      expect(page.items.map((r) => r.id)).toEqual([line.id]);
      expect(page.total).toBe(1);
    }
    // Mã / nhà mạng vẫn tìm được như trước.
    const byCode = await isp.list({ page: 1, limit: 50 }, { search: 'e2e-wan-search' });
    expect(byCode.items.map((r) => r.id)).toEqual([line.id]);
    const none = await isp.list({ page: 1, limit: 50 }, { search: '198.51.100.8' });
    expect(none.items).toEqual([]);
  });

  it('đổi IP WAN ghi một dòng lịch sử before → after; lưu lại y nguyên thì không ghi', async () => {
    const line = await isp.create('wan@test', {
      code: 'E2E-WAN-HIST',
      providerId,
      wanIps: ['192.0.2.1'],
    });
    await isp.update('wan@test', line.id, { wanIps: ['192.0.2.1', '192.0.2.2'] });
    await isp.update('wan@test', line.id, { wanIps: [' 192.0.2.1', '192.0.2.2', ''] });
    const cleared = await isp.update('wan@test', line.id, { wanIps: [] });
    expect(cleared.wanIps).toEqual([]);

    const history = await isp.history(line.id);
    const wanChanges = history
      .map((h) => h.changes?.wanIps)
      .filter(Boolean)
      .reverse();
    expect(wanChanges).toEqual([
      { before: '192.0.2.1', after: '192.0.2.1, 192.0.2.2' },
      { before: '192.0.2.1, 192.0.2.2', after: null },
    ]);

    // Sửa trường khác, không gửi `wanIps`: IP giữ nguyên.
    await isp.update('wan@test', line.id, { wanIps: ['192.0.2.9'] });
    const kept = await isp.update('wan@test', line.id, { hotline: '1800 1166' });
    expect(kept.wanIps).toEqual(['192.0.2.9']);
  });

  it('hai lượt sửa IP WAN chồng nhau: lượt sau ghi lịch sử từ ảnh SAU lượt trước', async () => {
    const line = await isp.create('wan@test', {
      code: 'E2E-WAN-RACE',
      providerId,
      wanIps: ['192.0.2.70'],
    });
    // Lượt chen ngang: khoá hàng cha và thay IP như `update` làm, nhưng CHƯA commit.
    const holder = new Pool({ connectionString: testDbUrl(scratch.name), max: 1 });
    holder.on('error', () => undefined);
    const client = await holder.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE isp_line SET updated_at = now() WHERE id = $1`, [line.id]);
      await client.query(`DELETE FROM isp_line_wan_ip WHERE isp_line_id = $1`, [line.id]);
      await client.query(
        `INSERT INTO isp_line_wan_ip (isp_line_id, address, sort_order) VALUES ($1, '192.0.2.71', 0)`,
        [line.id],
      );
      const running = isp.update('wan@test', line.id, { wanIps: ['192.0.2.72'] });
      await waitForLock(scratch.pool);
      await client.query('COMMIT');
      await running;
    } finally {
      client.release();
      await holder.end();
    }
    const history = await isp.history(line.id);
    expect(history[0].changes?.wanIps).toEqual({ before: '192.0.2.71', after: '192.0.2.72' });
  });

  it('ims_app ghi/xoá được bảng IP WAN (bảng thường, không phải bảng chỉ-thêm)', async () => {
    const app = new Pool({ connectionString: appDbUrl(scratch.name) });
    app.on('error', () => undefined);
    try {
      const line = await isp.create('wan@test', {
        code: 'E2E-WAN-ROLE',
        providerId,
        wanIps: ['192.0.2.50'],
      });
      await app.query(`DELETE FROM isp_line_wan_ip WHERE isp_line_id = $1`, [line.id]);
      await app.query(
        `INSERT INTO isp_line_wan_ip (isp_line_id, address, sort_order) VALUES ($1, '192.0.2.51', 0)`,
        [line.id],
      );
    } finally {
      await app.end();
    }
  });
});

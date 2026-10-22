import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { IspLineService } from '../src/modules/software/isp-line.service';
import { createScratchDb, migrationsDir, seedIspProviders, type ScratchDb } from './db';

/**
 * UX-E30 — nhập đường truyền từ Excel trên DB thật: nhà mạng / site / thiết bị trong file là
 * TÊN / MÃ, dịch ra id; mỗi dòng đi qua `prepare()` của form; ghi một transaction (cả IP WAN),
 * mỗi đường một dòng lịch sử; ai sửa xen vào giữa lúc đối chiếu và lúc ghi thì huỷ cả file.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.nhap@pmh.com.vn';
let ROUTER = '';

describe('Nhập đường truyền từ Excel', () => {
  let scratch: ScratchDb;
  let isp: IspLineService;
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) };
  const devices = {
    idsByCodes: jest.fn((codes: string[]) =>
      Promise.resolve(new Map(codes.filter((c) => c.toLowerCase() === 'rt-e2e-01').map((): [string, string] => ['rt-e2e-01', ROUTER]))),
    ),
    assertUsableWithin: jest.fn().mockResolvedValue(undefined),
    getByIds: jest.fn().mockResolvedValue(new Map()),
  };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_isp_import');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const catalogAudit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    isp = new IspLineService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, catalogAudit)),
      devices as unknown as DevicesApiService,
      audit as unknown as AuditWriterService,
    );
    const p = await seedIspProviders(scratch.pool, ['FPT E2E', 'Viettel E2E']);
    await scratch.pool.query(`INSERT INTO site (code, name) VALUES ('E2E-HCM', 'HCM')`);
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Router E2E') RETURNING id`);
    const router = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id) VALUES ('RT-E2E-01', 'Router', $1) RETURNING id`,
      [type.rows[0].id],
    );
    ROUTER = router.rows[0].id;
    await scratch.pool.query(
      `INSERT INTO isp_line (code, provider, provider_id, bandwidth) VALUES ('ISP-E2E-CU', 'FPT E2E', $1, '100 Mbps')`,
      [p['FPT E2E']],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const ROWS = [
    { rowNumber: 2, cells: { code: 'ISP-E2E-CU', bandwidth: '300 Mbps', wanIps: ['203.113.1.5'] } },
    {
      rowNumber: 3,
      cells: { code: 'ISP-E2E-MOI', provider: 'viettel e2e', site: 'e2e-hcm', device: 'RT-E2E-01', wanIps: ['203.113.9.1', '203.113.9.2'] },
    },
  ];

  it('đối chiếu: tên / mã dịch ra id (không phân biệt hoa thường); sửa + thêm; chưa ghi gì', async () => {
    const plan = await isp.planImport(ROWS);
    expect(plan.rows.map((row) => [row.label, row.action])).toEqual([
      ['ISP-E2E-CU', 'update'],
      ['ISP-E2E-MOI', 'create'],
    ]);
    expect(plan.rows[0].changes).toMatchObject({ bandwidth: { before: '100 Mbps', after: '300 Mbps' } });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM isp_line`);
    expect(rows[0].n).toBe(1);
  });

  it('nhà mạng / site / thiết bị không có trong danh mục, IP WAN sai, mã trùng trong file → dòng lỗi', async () => {
    const plan = await isp.planImport([
      { rowNumber: 2, cells: { code: 'ISP-E2E-A', provider: 'VNPT không có' } },
      { rowNumber: 3, cells: { code: 'ISP-E2E-B', provider: 'FPT E2E', site: 'KHONG-CO' } },
      { rowNumber: 4, cells: { code: 'ISP-E2E-C', provider: 'FPT E2E', device: 'MAY-LA' } },
      { rowNumber: 5, cells: { code: 'ISP-E2E-D', provider: 'FPT E2E', wanIps: ['300.1.1.1'] } },
      { rowNumber: 6, cells: { code: 'ISP-E2E-E', provider: 'FPT E2E' } },
      { rowNumber: 7, cells: { code: 'isp-e2e-e', provider: 'FPT E2E' } },
      { rowNumber: 8, cells: { code: 'ISP-E2E-F' } },
    ]);
    expect(plan.rows.map((row) => row.action)).toEqual(['error', 'error', 'error', 'error', 'create', 'error', 'error']);
    expect(plan.rows[0].message).toMatch(/Nhà mạng "VNPT không có"/);
    expect(plan.rows[1].message).toMatch(/Site "KHONG-CO"/);
    expect(plan.rows[2].message).toMatch(/Thiết bị "MAY-LA"/);
    expect(plan.rows[5].message).toMatch(/trùng với dòng 6/);
    expect(plan.rows[6].message).toMatch(/nhà mạng/i);
  });

  it('ghi: một transaction, IP WAN theo file, mỗi đường một dòng lịch sử, một dòng nhật ký tổng', async () => {
    const plan = await isp.planImport(ROWS);
    const result = await scratch.db.transaction((tx) => isp.commitImportWithin(tx, ACTOR, plan));
    expect(result).toEqual({ created: 1, updated: 1 });
    const lines = await scratch.pool.query(
      `SELECT l.code, l.bandwidth, l.device_id, array_agg(host(w.address) ORDER BY w.address) AS ips
         FROM isp_line l LEFT JOIN isp_line_wan_ip w ON w.isp_line_id = l.id GROUP BY l.id ORDER BY l.code`,
    );
    expect(lines.rows).toEqual([
      { code: 'ISP-E2E-CU', bandwidth: '300 Mbps', device_id: null, ips: ['203.113.1.5'] },
      { code: 'ISP-E2E-MOI', bandwidth: null, device_id: ROUTER, ips: ['203.113.9.1', '203.113.9.2'] },
    ]);
    expect(devices.assertUsableWithin).toHaveBeenCalledWith(expect.anything(), ROUTER);
    const history = await scratch.pool.query<{ action: string }>(`SELECT action FROM isp_line_history ORDER BY action`);
    expect(history.rows.map((row) => row.action)).toEqual(['created', 'updated']);
    expect(audit.appendWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'isp.imported', detail: expect.objectContaining({ created: 1, updated: 1 }) }),
    );
  });

  it('đường bị người khác sửa giữa lúc đối chiếu và lúc ghi → huỷ cả file', async () => {
    const plan = await isp.planImport([
      { rowNumber: 2, cells: { code: 'ISP-E2E-MOI-2', provider: 'FPT E2E' } },
      { rowNumber: 3, cells: { code: 'ISP-E2E-CU', bandwidth: '500 Mbps' } },
    ]);
    await scratch.pool.query(`UPDATE isp_line SET note = 'người khác sửa', updated_at = now() WHERE code = 'ISP-E2E-CU'`);
    await expect(scratch.db.transaction((tx) => isp.commitImportWithin(tx, ACTOR, plan))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ISP_ALREADY_CHANGED' }),
    });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM isp_line WHERE code = 'ISP-E2E-MOI-2'`);
    expect(rows[0].n).toBe(0);
  });
});

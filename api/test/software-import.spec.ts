import { runMigrations } from '../src/database/migration-runner';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SoftwareService } from '../src/modules/software/software.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * UX-E30 — nhập Phần mềm (bốn màn) từ Excel trên DB thật: nhà cung cấp là TÊN, dịch ra id; mỗi
 * dòng qua `prepare()` của form; ghi một transaction, mỗi hồ sơ một dòng lịch sử; giảm ghế dưới
 * số máy đang dùng thì bị chặn như form; ai sửa xen vào thì huỷ cả file.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.nhap@pmh.com.vn';

describe('Nhập phần mềm từ Excel', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sw_import');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const catalogAudit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    software = new SoftwareService(
      scratch.db,
      new CatalogApiService(new CatalogService(scratch.db, catalogAudit)),
      audit as unknown as AuditWriterService,
      {} as ExpiryApiService,
      new SystemConfigService(scratch.db),
    );
    await scratch.pool.query(`INSERT INTO vendor (name) VALUES ('Microsoft E2E')`);
    await scratch.pool.query(
      `INSERT INTO software (code, name, kind, license_model, seat_total, end_date)
       VALUES ('LIC-E2E-CU', 'Office E2E', 'license', 'perpetual', 5, NULL)`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const ROWS = [
    { rowNumber: 2, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-CU', seatTotal: 8, vendor: 'microsoft e2e' } },
    { rowNumber: 3, sheet: 'Hợp đồng bảo trì', cells: { code: 'BT-E2E-MOI', name: 'Bảo trì UPS E2E', kind: 'maintenance' as const } },
  ];

  it('đối chiếu: nhà cung cấp theo tên (không phân biệt hoa thường); sửa + thêm; chưa ghi gì', async () => {
    const plan = await software.planImport(ROWS);
    expect(plan.rows.map((row) => [row.label, row.action])).toEqual([
      ['LIC-E2E-CU', 'update'],
      ['BT-E2E-MOI', 'create'],
    ]);
    expect(plan.rows[0].changes).toMatchObject({ seatTotal: { before: 5, after: 8 } });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM software`);
    expect(rows[0].n).toBe(1);
  });

  it('nhà cung cấp không có, thiếu tên khi thêm, mã trùng trong file → dòng lỗi', async () => {
    const plan = await software.planImport([
      { rowNumber: 2, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-A', name: 'A', kind: 'license' as const, vendor: 'Không có E2E' } },
      // License mới không có cột Hình thức → thuê bao (mặc định của form), thiếu Hết hạn là lỗi.
      { rowNumber: 3, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-B', name: 'B', kind: 'license' as const } },
      { rowNumber: 4, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-C', name: 'C', kind: 'license' as const, endDate: '2027-01-01' } },
      { rowNumber: 5, sheet: 'Phần mềm', cells: { code: 'lic-e2e-c', name: 'C2', kind: 'license' as const } },
      { rowNumber: 6, sheet: 'Tên miền & SSL', cells: { code: 'SSL-E2E-X', name: 'X' } },
    ]);
    expect(plan.rows.map((row) => row.action)).toEqual(['error', 'error', 'create', 'error', 'error']);
    expect(plan.rows[0].message).toMatch(/Nhà cung cấp "Không có E2E"/);
    expect(plan.rows[3].message).toMatch(/trùng với dòng 4/);
    expect(plan.rows[4].message).toMatch(/Loại/);
  });

  it('bớt ghế dưới số máy đang dùng → dòng lỗi ngay ở bảng đối chiếu, không đợi lượt ghi', async () => {
    const sw = await scratch.pool.query<{ id: string }>(
      `INSERT INTO software (code, name, kind, license_model, seat_total) VALUES ('LIC-E2E-GHE', 'Ghế', 'license', 'perpetual', 3) RETURNING id`,
    );
    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('PC E2E ghế') RETURNING id`);
    for (const code of ['PC-E2E-G1', 'PC-E2E-G2']) {
      const device = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id) VALUES ($1, $2, $3) RETURNING id`,
        [code, code, type.rows[0].id],
      );
      await scratch.pool.query(`INSERT INTO license_assignment (software_id, device_id, assigned_by) VALUES ($1, $2, 'test')`, [
        sw.rows[0].id,
        device.rows[0].id,
      ]);
    }
    const plan = await software.planImport([{ rowNumber: 2, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-GHE', seatTotal: 1 } }]);
    expect(plan.rows[0]).toMatchObject({ action: 'error', label: 'LIC-E2E-GHE' });
  });

  it('ghi: một transaction, mỗi hồ sơ một dòng lịch sử, một dòng nhật ký tổng', async () => {
    const plan = await software.planImport(ROWS);
    const result = await scratch.db.transaction((tx) => software.commitImportWithin(tx, ACTOR, plan));
    expect(result).toEqual({ created: 1, updated: 1 });
    const { rows } = await scratch.pool.query(`SELECT code, kind, seat_total FROM software WHERE code <> 'LIC-E2E-GHE' ORDER BY code`);
    expect(rows).toEqual([
      { code: 'BT-E2E-MOI', kind: 'maintenance', seat_total: null },
      { code: 'LIC-E2E-CU', kind: 'license', seat_total: 8 },
    ]);
    const history = await scratch.pool.query<{ action: string }>(`SELECT action FROM software_history ORDER BY action`);
    expect(history.rows.map((row) => row.action)).toEqual(['created', 'updated']);
    expect(audit.appendWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'software.imported', detail: expect.objectContaining({ created: 1, updated: 1 }) }),
    );
  });

  it('hồ sơ bị người khác sửa giữa lúc đối chiếu và lúc ghi → huỷ cả file', async () => {
    const plan = await software.planImport([
      { rowNumber: 2, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-MOI-2', name: 'Mới', kind: 'license' as const, endDate: '2027-01-01' } },
      { rowNumber: 3, sheet: 'Phần mềm', cells: { code: 'LIC-E2E-CU', seatTotal: 9 } },
    ]);
    await scratch.pool.query(`UPDATE software SET note = 'người khác sửa', updated_at = now() WHERE code = 'LIC-E2E-CU'`);
    await expect(scratch.db.transaction((tx) => software.commitImportWithin(tx, ACTOR, plan))).rejects.toBeTruthy();
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM software WHERE code = 'LIC-E2E-MOI-2'`);
    expect(rows[0].n).toBe(0);
  });
});

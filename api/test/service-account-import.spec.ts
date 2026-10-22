import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import type { ServiceAccountParsedRow } from '../src/modules/service-accounts/service-account-import';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * UX-E30 — nhập tài khoản dịch vụ từ Excel, trên DB thật: đối chiếu đi qua đúng `prepare()` của
 * form, ghi MỘT transaction cho cả file, mỗi hồ sơ một dòng lịch sử, và lượt ghi gặp hồ sơ vừa
 * bị người khác sửa thì huỷ cả file.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.nhap@pmh.com.vn';

describe('Nhập tài khoản dịch vụ từ Excel', () => {
  let scratch: ScratchDb;
  let accounts: ServiceAccountService;
  const audit = { appendWithin: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sa_import');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    accounts = new ServiceAccountService(db, audit as unknown as AuditWriterService, {} as ExpiryApiService);
    await scratch.pool.query(
      `INSERT INTO service_account (code, kind, name, login, department, allowed_ips, created_by)
       VALUES ('VPN-AN', 'vpn', 'VPN An', 'an@pmh.com.vn', 'IT', '10.0.0.0/24', $1),
              ('TK-CHUNG', 'shared', 'Máy in chung', 'mayin', 'HC', NULL, $1)`,
      [ACTOR],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const ROWS: ServiceAccountParsedRow[] = [
    // Sửa: chỉ đổi phòng ban; cột Loại vắng → lấy loại đang có.
    { rowNumber: 2, input: { code: 'VPN-AN', department: 'Kế toán' } },
    // Y nguyên → không đổi.
    { rowNumber: 3, input: { code: 'TK-CHUNG', name: 'Máy in chung', kind: 'shared' } },
    // Thêm, không mã: suy từ tên đăng nhập; không tên: lấy tên đăng nhập.
    { rowNumber: 4, input: { kind: 'vpn', login: 'binh.tran@pmh.com.vn', allowedIps: '203.113.1.5' } },
  ];

  it('đối chiếu: sửa / không đổi / thêm (mã suy từ tên đăng nhập) — chưa ghi gì', async () => {
    const plan = await accounts.planImport(ROWS);
    expect(plan.rows.map((row) => [row.label, row.action])).toEqual([
      ['VPN-AN', 'update'],
      ['TK-CHUNG', 'unchanged'],
      ['BINH-TRAN', 'create'],
    ]);
    expect(plan.rows[0].changes).toEqual({ department: { before: 'IT', after: 'Kế toán' } });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM service_account`);
    expect(rows[0].n).toBe(2);
  });

  it('dòng sai luật của form và mã trùng trong file là dòng lỗi, nêu lý do', async () => {
    const plan = await accounts.planImport([
      { rowNumber: 2, input: { code: 'TK-MOI', kind: 'shared', name: 'X', groupName: 'Ngoài giờ' } },
      { rowNumber: 3, input: { code: 'DUP', kind: 'vpn', name: 'A' } },
      { rowNumber: 4, input: { code: 'dup', kind: 'vpn', name: 'B' } },
      { rowNumber: 5, error: 'Cột "Hết hạn" không phải ngày có thật.' },
    ]);
    expect(plan.rows.map((row) => row.action)).toEqual(['error', 'create', 'error', 'error']);
    expect(plan.rows[0].message).toMatch(/nhóm VPN/);
    expect(plan.rows[2].message).toMatch(/trùng với dòng 3/);
    expect(plan.summary.error).toBe(3);
  });

  it('ghi: một transaction, mỗi hồ sơ một dòng lịch sử, một dòng nhật ký tổng', async () => {
    const plan = await accounts.planImport(ROWS);
    const db = drizzle(scratch.pool) as unknown as Database;
    const result = await db.transaction((tx) => accounts.commitImportWithin(tx, ACTOR, plan));
    expect(result).toEqual({ created: 1, updated: 1 });
    const { rows } = await scratch.pool.query(
      `SELECT code, name, department, status FROM service_account ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'BINH-TRAN', name: 'binh.tran@pmh.com.vn', department: null, status: 'active' },
      { code: 'TK-CHUNG', name: 'Máy in chung', department: 'HC', status: 'active' },
      { code: 'VPN-AN', name: 'VPN An', department: 'Kế toán', status: 'active' },
    ]);
    const history = await scratch.pool.query<{ action: string }>(`SELECT action FROM service_account_history ORDER BY action`);
    expect(history.rows.map((row) => row.action)).toEqual(['created', 'updated']);
    expect(audit.appendWithin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'service_account.imported', detail: expect.objectContaining({ created: 1, updated: 1 }) }),
    );
  });

  it('hồ sơ bị người khác sửa giữa lúc đối chiếu và lúc ghi → huỷ cả file, không dòng nào ở lại', async () => {
    const plan = await accounts.planImport([
      { rowNumber: 2, input: { code: 'TK-MOI-2', kind: 'shared', name: 'Mới' } },
      { rowNumber: 3, input: { code: 'VPN-AN', department: 'Nhân sự' } },
    ]);
    await scratch.pool.query(`UPDATE service_account SET note = 'người khác sửa', updated_at = now() WHERE code = 'VPN-AN'`);
    const db = drizzle(scratch.pool) as unknown as Database;
    await expect(db.transaction((tx) => accounts.commitImportWithin(tx, ACTOR, plan))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SERVICE_ACCOUNT_ALREADY_CHANGED' }),
    });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM service_account WHERE code = 'TK-MOI-2'`);
    expect(rows[0].n).toBe(0);
  });
});

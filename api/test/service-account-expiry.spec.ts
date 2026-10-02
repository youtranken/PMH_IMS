import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { ExpiryDigestService } from '../src/modules/expiry/expiry-digest.service';
import { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { ServiceAccountExpirySource } from '../src/modules/service-accounts/service-account-expiry-source';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-20 — tài khoản dịch vụ có hạn dùng (tùy chọn), nhắc như mọi nguồn hạn khác, có Gia hạn.
 *
 * Chạy migration THẬT trên DB trắng (cột `end_date` + chỉ mục một phần), rồi đi qua đường sản
 * phẩm: nguồn hạn đăng ký vào sổ → `ExpiryService` gom → gia hạn qua `ExpiryService.renew` →
 * `ServiceAccountService.renew` → `renewal_history` + lịch sử hồ sơ, cùng một transaction.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

describe('Q-20 · hạn dùng của tài khoản dịch vụ', () => {
  let scratch: ScratchDb;
  let accounts: ServiceAccountService;
  let expiry: ExpiryService;
  let registry: ExpirySourceRegistry;

  async function seed(code: string, endDate: string | null, status = 'active'): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO service_account (code, kind, name, login, end_date, status, created_by)
       VALUES ($1, 'vpn', $2, $3, $4, $5, $6) RETURNING id`,
      [code, `VPN ${code}`, `${code.toLowerCase()}@pmh.com.vn`, endDate, status, ACTOR],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sa_expiry');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: () => Promise.resolve(30),
    } as unknown as SystemConfigService;
    registry = new ExpirySourceRegistry();
    expiry = new ExpiryService(scratch.db, registry, audit, config);
    accounts = new ServiceAccountService(
      scratch.db,
      audit,
      new ExpiryApiService(expiry, {} as ExpiryDigestService),
    );
    new ServiceAccountExpirySource(registry, accounts).onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('migration: cột end_date cho phép NULL, có chỉ mục một phần cho tài khoản đang dùng', async () => {
    const { rows: cols } = await scratch.pool.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_name = 'service_account' AND column_name = 'end_date'`,
    );
    expect(cols).toEqual([{ is_nullable: 'YES', data_type: 'date' }]);
    const { rows: idx } = await scratch.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'service_account' AND indexdef LIKE '%end_date%'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/WHERE .*status = 'active'.*end_date IS NOT NULL/);
  });

  it('nguồn hạn "service_account" có trong sổ, gia hạn được, không nhận hợp đồng/chi phí', () => {
    expect(registry.list()).toContainEqual({
      kind: 'service_account',
      label: 'Tài khoản dịch vụ',
      canRenew: true,
      canRenewTerms: false,
    });
  });

  it('chỉ tài khoản ĐANG DÙNG có hạn trong cửa sổ; ngừng dùng và không có hạn thì không nhắc', async () => {
    const due = await seed('VPN-E2E-HAN', '2026-11-15');
    await seed('VPN-E2E-NGUNG', '2026-11-10', 'disabled');
    await seed('VPN-E2E-KHONG-HAN', null);
    await seed('VPN-E2E-XA', '2028-01-01');

    const { items, failed } = await registry.collect('2026-10-01', '2026-12-31', ['service_account']);
    expect(failed).toEqual([]);
    expect(items).toEqual([
      expect.objectContaining({
        id: due,
        kind: 'service_account',
        code: 'VPN-E2E-HAN',
        label: 'VPN-E2E-HAN — VPN VPN-E2E-HAN',
        end: '2026-11-15',
        link: `/service-accounts/${due}`,
      }),
    ]);
  });

  it('gia hạn từ màn Sắp hết hạn: đổi hạn, ghi sổ gia hạn và lịch sử hồ sơ, KHÔNG đổi trạng thái', async () => {
    const id = await seed('VPN-E2E-GIA-HAN', '2026-10-20');
    await expiry.renew(ACTOR, 'service_account', id, '2027-10-20');

    const record = await accounts.findOne(id);
    expect(record.endDate).toBe('2027-10-20');
    expect(record.status).toBe('active');

    const { rows: ledger } = await scratch.pool.query<{ object_kind: string; old_end: string; new_end: string }>(
      `SELECT object_kind, to_char(old_end, 'YYYY-MM-DD') AS old_end, to_char(new_end, 'YYYY-MM-DD') AS new_end
         FROM renewal_history WHERE object_id = $1`,
      [id],
    );
    expect(ledger).toEqual([{ object_kind: 'service_account', old_end: '2026-10-20', new_end: '2027-10-20' }]);

    const history = await accounts.history(id);
    expect(history[0]).toMatchObject({
      action: 'renewed',
      changes: { endDate: { before: '2026-10-20', after: '2027-10-20' } },
    });
  });

  it('đường hỏng: hạn mới không sau hạn cũ, hay tài khoản đã ngừng dùng → từ chối, không ghi gì', async () => {
    const id = await seed('VPN-E2E-LUI', '2026-10-20');
    await expect(expiry.renew(ACTOR, 'service_account', id, '2026-10-01')).rejects.toMatchObject({
      response: { code: 'SERVICE_ACCOUNT_RENEW_INVALID' },
    });
    const stopped = await seed('VPN-E2E-DA-NGUNG', '2026-10-20', 'disabled');
    await expect(expiry.renew(ACTOR, 'service_account', stopped, '2027-10-20')).rejects.toMatchObject({
      response: { code: 'SERVICE_ACCOUNT_RENEW_INVALID' },
    });
    const { rows } = await scratch.pool.query(
      `SELECT 1 FROM renewal_history WHERE object_id = ANY($1::uuid[])`,
      [[id, stopped]],
    );
    expect(rows).toHaveLength(0);
    expect((await accounts.findOne(id)).endDate).toBe('2026-10-20');
  });

  it('tạo / sửa qua service: hạn dùng lưu được, xoá trắng thì bỏ hạn, lịch sử ghi lần đổi', async () => {
    const created = await accounts.create(ACTOR, {
      kind: 'vpn',
      login: 'vpn-e2e-tao@pmh.com.vn',
      endDate: '2027-01-31',
    });
    expect(created.endDate).toBe('2027-01-31');
    const cleared = await accounts.update(ACTOR, created.id, {
      code: created.code,
      kind: 'vpn',
      name: created.name,
      endDate: '',
    });
    expect(cleared.endDate).toBeNull();
    const history = await accounts.history(created.id);
    expect(history[0].changes).toMatchObject({ endDate: { before: '2027-01-31', after: null } });
  });
});

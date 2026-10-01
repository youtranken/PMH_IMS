import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations } from '../src/database/migration-runner';
import type { Database } from '../src/database/database.module';
import { ServiceAccountService } from '../src/modules/service-accounts/service-account.service';
import type { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bộ lọc "VPN mở mọi IP" của danh sách tài khoản dịch vụ — lọc ở SERVER vì danh sách phân
 * trang. Cùng luật với `allowsAnyIp` bên web: chỉ tài khoản VPN; ô dải IP trống (hoặc chỉ có
 * dấu ngăn) hay có mục `0.0.0.0/0`.
 */

const TEST_TIMEOUT = 120_000;
const ACTOR = 'nguoi.truc@pmh.com.vn';

describe('Lọc VPN mở mọi IP', () => {
  let scratch: ScratchDb;
  let accounts: ServiceAccountService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_sa_any_ip');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = drizzle(scratch.pool) as unknown as Database;
    accounts = new ServiceAccountService(db, {} as unknown as AuditWriterService, {} as ExpiryApiService);
    const seed = async (code: string, kind: string, allowedIps: string | null) =>
      scratch.pool.query(
        `INSERT INTO service_account (code, kind, name, allowed_ips, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [code, kind, code, allowedIps, ACTOR],
      );
    await seed('VPN-TRONG', 'vpn', null);
    await seed('VPN-DAU-NGAN', 'vpn', ' , ;\n');
    await seed('VPN-MOI-NOI', 'vpn', '203.113.1.5, 0.0.0.0/0');
    await seed('VPN-GIOI-HAN', 'vpn', '203.113.1.5\n118.70.2.0/24');
    await seed('VPN-GAN-GIONG', 'vpn', '10.0.0.0/08');
    await seed('DUNG-CHUNG', 'shared', null);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chỉ VPN trống hoặc có 0.0.0.0/0', async () => {
    const page = await accounts.list({ page: 1, limit: 50 }, { anyIp: true });
    expect(page.items.map((row) => row.code).sort()).toEqual(
      ['VPN-DAU-NGAN', 'VPN-MOI-NOI', 'VPN-TRONG'].sort(),
    );
    expect(page.total).toBe(3);
  });

  it('không bật lọc thì đủ cả sáu', async () => {
    expect((await accounts.list({ page: 1, limit: 50 })).total).toBe(6);
  });
});

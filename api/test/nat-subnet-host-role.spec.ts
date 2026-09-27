import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-07 — sổ NAT xét địa chỉ mạng/quảng bá theo DẢI chứa IP, không theo octet cuối.
 *
 * Phần luật đã có bảng test đơn vị (`nat-rules.spec.ts`); bài này hỏi phần còn lại: service có
 * tìm đúng dải đang sống chứa IP bằng SQL thật (`cidr >>= inet`) không. Các phụ thuộc khác là
 * đồ giả rỗng — lượt ghi hợp lệ sẽ vấp vào chúng, và đó là dấu hiệu nó đã qua cửa kiểm IP.
 */

const TEST_TIMEOUT = 120_000;

describe('BE-07 · NAT xét IP theo dải chứa nó', () => {
  let scratch: ScratchDb;
  let service: NatRuleService;

  const draft = (internalIp: string) => ({
    deviceId: '00000000-0000-4000-8000-000000000001',
    protocol: 'tcp',
    externalFrom: 8080,
    externalTo: 8080,
    internalIp,
    internalPort: 80,
    usedBy: 'Phong IT E2E',
    reason: 'Kiem vai tro IP',
  });

  async function codeOf(internalIp: string): Promise<string> {
    return service.create('sa@pmh.com.vn', draft(internalIp) as never).then(
      () => 'ok',
      (error: unknown) =>
        ((error as { getResponse?: () => { code?: string } }).getResponse?.()?.code ?? 'khac'),
    );
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_nat_role');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    await scratch.pool.query(
      `INSERT INTO subnet (name, cidr, created_by) VALUES
         ('Dai E2E /25', '10.20.30.0/25', 'test'),
         ('Dai E2E /31', '10.20.31.254/31', 'test')`,
    );
    service = new NatRuleService(
      scratch.db,
      {} as AuditWriterService,
      {} as DevicesApiService,
      {} as IpAddressService,
      {} as CatalogApiService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it.each([
    ['10.20.30.127', 'NAT_INVALID', 'quảng bá của /25'],
    ['10.20.30.0', 'NAT_INVALID', 'địa chỉ mạng của /25'],
    ['10.20.31.255', 'qua cửa', 'máy trong /31'],
    ['10.20.30.126', 'qua cửa', 'máy trong /25'],
    ['10.99.99.255', 'NAT_INVALID', 'ngoài mọi dải — đoán theo octet cuối'],
  ])('%s → %s (%s)', async (ip, expected) => {
    const code = await codeOf(ip);
    if (expected === 'NAT_INVALID') expect(code).toBe('NAT_INVALID');
    else expect(code).not.toBe('NAT_INVALID');
  });
});

import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { IpAddressService } from '../src/modules/ipam/ip-address.service';
import { NatRuleService } from '../src/modules/ipam/nat-rule.service';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-20 · hai ngưỡng của mảng IP đọc từ `system_config` (AD-11), không nằm cứng trong code:
 *   · `ipam.subnet_min_prefix` — dải rộng nhất được khai;
 *   · `nat.wide_port_range` — dải cổng ngoài rộng hơn ngần này thì cảnh báo.
 *
 * Đổi hàng trong bảng → hành vi đổi theo. Mỗi bài dùng một `SystemConfigService` mới để khỏi
 * dính bộ nhớ đệm 30 giây của bài trước.
 */

const TEST_TIMEOUT = 120_000;

describe('BE-20 · ngưỡng IPAM đọc từ system_config', () => {
  let scratch: ScratchDb;
  const actor = 'be20@test';
  const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;

  async function setConfig(key: string, value: number): Promise<SystemConfigService> {
    await scratch.pool.query('UPDATE system_config SET value = $2::jsonb WHERE key = $1', [
      key,
      JSON.stringify(value),
    ]);
    return new SystemConfigService(scratch.db);
  }

  function subnets(config: SystemConfigService): SubnetService {
    return new SubnetService(scratch.db, audit, {} as CatalogApiService, config);
  }

  async function codeAndMessage(p: Promise<unknown>): Promise<{ code: string; message: string }> {
    try {
      await p;
      return { code: 'ok', message: '' };
    } catch (error) {
      const body = (error as { getResponse?: () => { code?: string; message?: string } }).getResponse?.();
      return { code: body?.code ?? String(error), message: body?.message ?? '' };
    }
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_be20_ipam');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('mặc định seed: /24 khai được, /23 bị chặn', async () => {
    const service = subnets(await setConfig('ipam.subnet_min_prefix', 24));
    expect((await codeAndMessage(service.create(actor, { name: 'E2E a', cidr: '10.61.0.0/24' }))).code).toBe('ok');
    const wide = await codeAndMessage(service.create(actor, { name: 'E2E b', cidr: '10.62.0.0/23' }));
    expect(wide.code).toBe('SUBNET_INVALID');
    expect(wide.message).toContain('/24');
  });

  it('siết lên /26 → /24 bị chặn, câu lỗi nói đúng trần mới; /26 vẫn khai được', async () => {
    const service = subnets(await setConfig('ipam.subnet_min_prefix', 26));
    const wide = await codeAndMessage(service.create(actor, { name: 'E2E c', cidr: '10.63.0.0/24' }));
    expect(wide.code).toBe('SUBNET_INVALID');
    expect(wide.message).toContain('/26');
    expect((await codeAndMessage(service.create(actor, { name: 'E2E d', cidr: '10.64.0.0/26' }))).code).toBe('ok');
  });

  it('siết trần KHÔNG khoá dải /24 đang có: sửa tên kèm đúng dải cũ vẫn lưu được', async () => {
    const before = subnets(await setConfig('ipam.subnet_min_prefix', 24));
    const row = await before.create(actor, { name: 'E2E e', cidr: '10.65.0.0/24' });

    const after = subnets(await setConfig('ipam.subnet_min_prefix', 26));
    const result = await codeAndMessage(
      after.update(actor, row.id, { name: 'E2E e2', cidr: '10.65.0.0/24', gateway: '10.65.0.1' }),
    );
    expect(result.code).toBe('ok');
  });

  it('`nat.wide_port_range` hạ xuống 100 → dải 200 cổng có cảnh báo; 1000 thì không', async () => {
    const input = {
      deviceId: '00000000-0000-4000-8000-000000000001',
      protocol: 'tcp' as const,
      externalFrom: 8000,
      externalTo: 8199,
      internalIp: '10.70.0.5',
      internalPort: 80,
      usedBy: 'Phong IT E2E',
      reason: 'Kiem nguong canh bao',
    };
    const nat = (config: SystemConfigService) =>
      new NatRuleService(
        scratch.db,
        audit,
        {} as DevicesApiService,
        {} as IpAddressService,
        {} as CatalogApiService,
        config,
      ) as unknown as { requireValid(i: typeof input): Promise<string[]> };

    const loose = nat(await setConfig('nat.wide_port_range', 1000));
    expect(await loose.requireValid(input)).toEqual([]);

    const tight = nat(await setConfig('nat.wide_port_range', 100));
    const warnings = await tight.requireValid(input);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('100');
  });
});

import { BadRequestException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-11 — PATCH chỉ gửi `cidr` (gọi API thẳng; form web luôn gửi kèm gateway) thì gateway ĐANG
 * CÓ vẫn phải hợp với dải mới. Không kiểm ở service thì CHECK của DB bắn 23514 → 500 trắng.
 */

const TEST_TIMEOUT = 120_000;

describe('BE-11 · đổi CIDR phải kiểm gateway đang có', () => {
  let scratch: ScratchDb;
  let subnets: SubnetService;
  const actor = 'be11@test';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_subnet_cidr_gateway');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    subnets = new SubnetService(
      scratch.db,
      audit,
      {} as CatalogApiService,
      new SystemConfigService(scratch.db),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('chỉ gửi cidr mới mà gateway cũ nằm ngoài → 400 GATEWAY_OUT_OF_SUBNET, dải giữ nguyên', async () => {
    const subnet = await subnets.create(actor, {
      name: 'LAN',
      cidr: '10.21.0.0/24',
      gateway: '10.21.0.1',
    });
    const error = await subnets.update(actor, subnet.id, { cidr: '10.22.0.0/24' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('GATEWAY_OUT_OF_SUBNET');
    expect(body.message).toContain('10.21.0.1');
    expect(body.message).toContain('10.22.0.0/24');

    const { rows } = await scratch.pool.query<{ cidr: string }>(
      'SELECT cidr::text AS cidr FROM subnet WHERE id = $1',
      [subnet.id],
    );
    expect(rows[0].cidr).toBe('10.21.0.0/24');
  });

  it('gateway cũ vẫn nằm trong dải mới thì đổi được', async () => {
    const subnet = await subnets.create(actor, {
      name: 'LAN 2',
      cidr: '10.23.0.0/25',
      gateway: '10.23.0.1',
    });
    const after = await subnets.update(actor, subnet.id, { cidr: '10.23.0.0/24' });
    expect(after.cidr).toBe('10.23.0.0/24');
    expect(after.gateway).toBe('10.23.0.1');
  });

  it('gửi cả cidr mới và gateway mới hợp lệ thì đổi được', async () => {
    const subnet = await subnets.create(actor, {
      name: 'LAN 3',
      cidr: '10.24.0.0/24',
      gateway: '10.24.0.1',
    });
    const after = await subnets.update(actor, subnet.id, {
      cidr: '10.25.0.0/24',
      gateway: '10.25.0.1',
    });
    expect(after.cidr).toBe('10.25.0.0/24');
  });
});

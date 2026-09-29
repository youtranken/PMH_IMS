import { ConflictException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { SubnetService } from '../src/modules/ipam/subnet.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DB-02 — hai dải đang dùng không được chồng lên nhau (`docs/QUYET-DINH.md` Q-01).
 *
 * Toàn công ty là một mạng, mỗi IP là duy nhất. Trước bản này chỉ có UNIQUE trên đúng giá trị
 * `cidr`, nên 10.0.0.0/24 và 10.0.0.0/25 cùng tồn tại được: một IP có hai hồ sơ ở hai dải, và
 * NAT gắn vào hồ sơ nào là tuỳ may rủi.
 */

const TEST_TIMEOUT = 120_000;

describe('DB-02 · dải IP không chồng nhau', () => {
  let scratch: ScratchDb;
  let subnets: SubnetService;
  const actor = 'db02@test';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_subnet_overlap');
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

  async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return ((error as ConflictException).getResponse() as { code?: string }).code;
    }
  }

  it('dải nằm trong dải đang dùng thì bị từ chối bằng 409 rõ ràng', async () => {
    await subnets.create(actor, { name: 'LAN chính', cidr: '10.9.0.0/24' });
    expect(await codeOf(subnets.create(actor, { name: 'Con', cidr: '10.9.0.0/25' }))).toBe(
      'SUBNET_OVERLAP',
    );
    expect(await codeOf(subnets.create(actor, { name: 'Trùng', cidr: '10.9.0.0/24' }))).toBe(
      'SUBNET_OVERLAP',
    );
  });

  it('hai dải liền kề không chồng thì vẫn khai được', async () => {
    await subnets.create(actor, { name: 'A', cidr: '10.9.1.0/26' });
    await subnets.create(actor, { name: 'B', cidr: '10.9.1.64/26' });
  });

  it('dải đã vô hiệu hoá không chặn; bật lại nó khi đã có dải chồng thì bị từ chối', async () => {
    const old = await subnets.create(actor, { name: 'Cũ', cidr: '10.9.2.0/24' });
    await scratch.pool.query(
      `UPDATE subnet SET voided_at = now(), voided_by = 'x', void_reason = 'x' WHERE id = $1`,
      [old.id],
    );
    await subnets.create(actor, { name: 'Mới', cidr: '10.9.2.0/25' });
    expect(await codeOf(subnets.restore(actor, old.id))).toBe('SUBNET_OVERLAP');
  });

  it('chặn ở tầng DB, không chỉ ở service', async () => {
    await expect(
      scratch.pool.query(
        `INSERT INTO subnet (name, cidr, created_by) VALUES ('sql', '10.9.0.128/25', 'x')`,
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });
});

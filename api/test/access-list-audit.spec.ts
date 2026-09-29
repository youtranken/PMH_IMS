import { runMigrations } from '../src/database/migration-runner';
import { AccessListService } from '../src/modules/vault/access-list.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import type { SoftwareApiService } from '../src/modules/software/software.api';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * BE-19 — audit ma trận quyền két phải kể đủ chuyện: đổi tầng thì ghi tầng CŨ, và một lời gán
 * bị gỡ đúng một lần thì có đúng một dòng audit, dù hai người cùng bấm Gỡ.
 */

const TEST_TIMEOUT = 120_000;
const MEMBER = 'e2e-be19@qa.test';

interface Entry {
  action: string;
  objectId: string;
  detail: Record<string, unknown>;
}

describe('AccessListService · audit gán/gỡ quyền két (BE-19)', () => {
  let scratch: ScratchDb;
  let access: AccessListService;
  const log: Entry[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_access_list_audit');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = {
      appendWithin: (_tx: unknown, entry: Entry) => {
        log.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditWriterService;
    access = new AccessListService(
      scratch.db,
      audit,
      {
        lists: () => Promise.resolve({ sites: [], deviceTypes: [], ispProviders: [] }),
      } as unknown as CatalogApiService,
      {} as DevicesApiService,
      {} as SoftwareApiService,
      {} as ServiceAccountsApiService,
      {
        recipientsByRole: () => Promise.resolve([{ email: MEMBER, fullName: 'BE19' }]),
      } as unknown as UsersApiService,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** Như `waitForLock`, nhưng chờ đủ `n` câu lệnh đứng chờ khoá. */
  async function waitForWaiters(n: number, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if (rows[0].n >= n) return;
      if (Date.now() > deadline) throw new Error(`Chưa đủ ${n} câu lệnh chờ khoá.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeEach(() => {
    log.length = 0;
  });

  const grant = (tier: 'whitelist' | 'needs_approval', scopeRef: string) =>
    access.upsert('sa@qa.test', {
      memberEmail: MEMBER,
      scopeType: 'software_kind',
      scopeRef,
      tier,
    });

  it('gán mới ghi fromTier = null; đổi tầng ghi tầng cũ', async () => {
    const first = await grant('whitelist', 'ssl');
    const changed = await grant('needs_approval', 'ssl');
    expect(changed.id).toBe(first.id);
    expect(log.map((e) => [e.action, e.detail.fromTier, e.detail.tier])).toEqual([
      ['vault.access.granted', null, 'whitelist'],
      ['vault.access.granted', 'whitelist', 'needs_approval'],
    ]);
  });

  it('hai người cùng gỡ một lời gán: đúng một dòng audit, người sau nhận 404', async () => {
    const rule = await grant('whitelist', 'domain');
    log.length = 0;
    /*
     * Giữ khoá hàng từ một phiên khác cho tới khi CẢ HAI lượt gỡ đã đứng chờ, rồi mới nhả: đó là
     * cách duy nhất ép hai lượt cùng đọc thấy hàng còn đó, không phụ thuộc may rủi của nhịp chạy.
     */
    const blocker = await scratch.pool.connect();
    let results: PromiseSettledResult<void>[];
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM access_list WHERE id = $1 FOR UPDATE', [rule.id]);
      const racing = Promise.allSettled([
        access.remove('sa@qa.test', rule.id),
        access.remove('admin@qa.test', rule.id),
      ]);
      await waitForWaiters(2);
      await blocker.query('COMMIT');
      results = await racing;
    } finally {
      blocker.release();
    }
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ response: { code: 'ACCESS_RULE_NOT_FOUND' } });
    expect(log.filter((e) => e.action === 'vault.access.revoked')).toEqual([
      expect.objectContaining({
        objectId: rule.id,
        detail: expect.objectContaining({ tier: 'whitelist', member: MEMBER }),
      }),
    ]);
    const { rows } = await scratch.pool.query(`SELECT 1 FROM access_list WHERE id = $1`, [rule.id]);
    expect(rows).toHaveLength(0);
  });

  it('gỡ id không tồn tại → 404, không ghi audit', async () => {
    await expect(
      access.remove('sa@qa.test', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ response: { code: 'ACCESS_RULE_NOT_FOUND' } });
    expect(log).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Tab "Đã gia hạn" lọc theo khoảng ngày (EX-008): ranh giới ngày cắt theo `app.timezone`, cùng
 * múi với giờ in trên màn — lượt gia hạn lúc 6 giờ sáng giờ VN thuộc ngày giờ VN.
 */

const TEST_TIMEOUT = 120_000;

describe('Đã gia hạn · khoảng ngày', () => {
  let scratch: ScratchDb;
  let expiry: ExpiryService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_expiry_renewals_range');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    expiry = new ExpiryService(
      scratch.db,
      new ExpirySourceRegistry(),
      {} as AuditWriterService,
      new SystemConfigService(scratch.db),
    );
    const insert = (label: string, at: string) =>
      scratch.pool.query(
        `INSERT INTO renewal_history (object_kind, object_id, label, old_end, new_end, actor, created_at)
         VALUES ('license', $1, $2, '2026-01-01', '2027-01-01', 'sa@qa.test', $3)`,
        [randomUUID(), label, at],
      );
    // 23:00 UTC ngày 09/09 = 06:00 ngày 10/09 giờ VN.
    await insert('E2E sáng 10/09 giờ VN', '2026-09-09T23:00:00Z');
    await insert('E2E ngày 11/09', '2026-09-11T05:00:00Z');
    await insert('E2E ngày 20/09', '2026-09-20T05:00:00Z');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const labels = async (range: { from?: string; to?: string }) =>
    (await expiry.recentRenewals(range)).map((row) => row.label);

  it('không lọc: mới nhất trước', async () => {
    expect(await labels({})).toEqual(['E2E ngày 20/09', 'E2E ngày 11/09', 'E2E sáng 10/09 giờ VN']);
  });

  it('from/to đều BAO GỒM, ngày cắt theo giờ VN chứ không theo UTC', async () => {
    expect(await labels({ from: '2026-09-10', to: '2026-09-11' })).toEqual([
      'E2E ngày 11/09',
      'E2E sáng 10/09 giờ VN',
    ]);
    expect(await labels({ to: '2026-09-09' })).toEqual([]);
    expect(await labels({ from: '2026-09-12' })).toEqual(['E2E ngày 20/09']);
  });
});

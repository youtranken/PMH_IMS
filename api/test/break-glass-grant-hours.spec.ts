import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { BreakGlassService } from '../src/modules/vault/break-glass.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { AccessListService } from '../src/modules/vault/access-list.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Số giờ cấp khi DUYỆT break-glass không được vượt số giờ người ta XIN.
 *
 * Người duyệt được RÚT NGẮN (nhìn lý do rồi quyết), nhưng cấp dài hơn yêu cầu là mở két lâu hơn
 * chính người cần nó nghĩ là cần — và nhật ký FR-025 in ra một grant "đã duyệt" mà người xin
 * chưa từng xin. Trần cấu hình `breakglass.max_grant_hours` vẫn là trần thứ hai.
 */

const TEST_TIMEOUT = 120_000;
const MAX_GRANT_HOURS = 24;

describe('Break-glass: số giờ cấp ≤ số giờ xin ≤ trần cấu hình', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let breakGlass: BreakGlassService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_bg_grant_hours');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const kinds = new ApprovalKindRegistry();
    approvals = new ApprovalsService(scratch.db, audit, kinds);
    const config = {
      getNumber: (key: string) =>
        key === 'breakGlassMaxGrantHours'
          ? Promise.resolve(MAX_GRANT_HOURS)
          : Promise.reject(new Error(`khoá không ngờ tới: ${key}`)),
    } as unknown as SystemConfigService;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      new ApprovalsApiService(approvals),
      {} as AccessListService,
      config,
      new OutboxService(scratch.db, config, {} as SweepService),
      {} as VaultOwnersService,
      {} as VaultService,
      {} as UsersApiService,
    );
    breakGlass.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /** Phiếu dựng thẳng trong DB với số giờ xin tuỳ ý — kể cả phiếu cũ vượt trần hiện tại. */
  function request(hours: number) {
    return scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: 'break_glass',
        requester: `xin-${randomUUID().slice(0, 8)}@qa.test`,
        subjectType: 'device',
        subjectId: randomUUID(),
        reason: 'Sự cố lúc 2 giờ sáng',
        payload: { hours },
      }),
    );
  }

  async function grantedHours(id: string): Promise<number> {
    const { rows } = await scratch.pool.query<{ hours: string }>(
      `SELECT round(extract(epoch FROM expires_at - decided_at) / 3600) AS hours
         FROM approval WHERE id = $1`,
      [id],
    );
    return Number(rows[0].hours);
  }

  it.each([
    ['người duyệt gõ nhiều hơn số xin → cấp đúng số xin', 4, 10, 4],
    ['người duyệt rút ngắn → cấp số rút ngắn', 4, 2, 2],
    ['không gõ → cấp số xin', 4, undefined, 4],
    ['người duyệt gõ bằng số xin → giữ nguyên', 6, 6, 6],
    [
      'phiếu xin vượt trần (cấu hình hạ sau khi xin) → kẹp theo trần',
      30,
      undefined,
      MAX_GRANT_HOURS,
    ],
    ['phiếu xin vượt trần, người duyệt gõ 40 → vẫn trần', 30, 40, MAX_GRANT_HOURS],
  ])(
    '%s',
    async (_label, asked, typed, expected) => {
      const created = await request(asked);
      await breakGlass.approve(
        'duyet@qa.test',
        created.id,
        typed === undefined ? {} : { hours: typed },
      );
      expect(await grantedHours(created.id)).toBe(expected);
    },
    TEST_TIMEOUT,
  );
});

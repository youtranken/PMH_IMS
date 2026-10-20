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
import type { AuthApiService } from '../src/modules/auth/auth.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { approveByCode, breakGlassCodes } from './break-glass-codes';
import type { MailContentRegistry } from '../src/common/mail-content.registry';

/**
 * Duyệt bằng mã (Q-30) cấp ĐÚNG số giờ người ta xin, kẹp theo trần `breakglass.max_grant_hours`.
 *
 * Người duyệt không còn ô gõ giờ: đọc mã là đồng ý với số giờ ghi trong thư. Phiếu xin trước khi
 * trần bị hạ vẫn chỉ được cấp tới trần hiện tại — trần đọc lúc nhập mã, không lúc xin.
 */

const TEST_TIMEOUT = 120_000;
const MAX_GRANT_HOURS = 24;

describe('Break-glass: số giờ cấp = số giờ xin, kẹp theo trần cấu hình', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let breakGlass: BreakGlassService;
  let contents: MailContentRegistry;
  const SESSION = randomUUID();

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
          : key === 'breakGlassPendingExpireHours'
            ? Promise.resolve(8)
            : Promise.reject(new Error(`khoá không ngờ tới: ${key}`)),
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    const users = {
      recipientsByRole: () => Promise.resolve([{ email: 'duyet@qa.test', fullName: 'Duyệt' }]),
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
    } as unknown as UsersApiService;
    const approvalsApi = new ApprovalsApiService(approvals);
    const outbox = new OutboxService(scratch.db, config, {} as SweepService);
    const built = breakGlassCodes({ db: scratch.db, outbox, approvals: approvalsApi, kinds, users, config });
    contents = built.contents;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      approvalsApi,
      { tierFor: () => Promise.resolve('needs_approval') } as unknown as AccessListService,
      config,
      outbox,
      { describe: () => Promise.resolve({ orphan: true }) } as unknown as VaultOwnersService,
      {} as VaultService,
      users,
      {
        isSessionAlive: () => Promise.resolve(true),
        aliveSessionIds: (ids: string[]) => Promise.resolve(new Set(ids)),
      } as unknown as AuthApiService,
      { register: () => undefined } as unknown as SweepService,
      built.codes,
    );
    breakGlass.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  /**
   * Phiếu qua đúng đường gửi; `storedHours` ghi đè số giờ trong phiếu để dựng phiếu cũ xin vượt
   * trần hiện tại (trần bị hạ sau khi xin).
   */
  async function request(hours: number, storedHours?: number) {
    const created = await breakGlass.request(
      { email: `xin-${randomUUID().slice(0, 8)}@qa.test`, sessionId: SESSION },
      { ownerType: 'device', ownerId: randomUUID(), reason: 'Sự cố lúc 2 giờ sáng', hours, approver: 'duyet@qa.test' },
    );
    if (storedHours !== undefined) {
      await scratch.pool.query(`UPDATE approval SET payload = jsonb_build_object('hours', $2::int) WHERE id = $1`, [
        created.id,
        storedHours,
      ]);
    }
    return created;
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
    ['xin 4 giờ → cấp 4 giờ', 4, undefined, 4],
    ['xin 6 giờ → cấp 6 giờ', 6, undefined, 6],
    ['xin vượt trần lúc gửi → kẹp ngay lúc gửi', 30, undefined, MAX_GRANT_HOURS],
    ['phiếu cũ ghi số giờ vượt trần hiện tại → kẹp theo trần lúc nhập mã', 4, 30, MAX_GRANT_HOURS],
  ])(
    '%s',
    async (_label, asked, stored, expected) => {
      const created = await request(asked, stored);
      await approveByCode(breakGlass, contents, { email: created.requester, sessionId: SESSION }, created.id);
      expect(await grantedHours(created.id)).toBe(expected);
    },
    TEST_TIMEOUT,
  );
});

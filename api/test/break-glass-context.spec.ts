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
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ngữ cảnh người duyệt và người xin cần để quyết nhanh trên điện thoại (VLT-FLOW) — chỉ CON SỐ
 * và VAI, không một danh tính nào khác:
 *
 *   - người duyệt thấy vai người xin và "lần thứ N trong X ngày" (X = `breakglass.recent_window_days`);
 *   - người xin thấy "đã báo N người duyệt" (không phải danh sách ai) và số giây quyền còn lại do
 *     SERVER tính (AD-6) — client không tự trừ giờ theo đồng hồ máy.
 *
 * Đếm trên Postgres thật vì cửa sổ ngày là một câu `created_at >= …` trong SQL.
 */

const TEST_TIMEOUT = 120_000;
const WINDOW_DAYS = 30;

describe('Break-glass: ngữ cảnh cho người duyệt và người xin', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let breakGlass: BreakGlassService;
  const APPROVERS = [
    { email: 'sa@qa.test', fullName: 'SA', role: 'sa' },
    { email: 'admin1@qa.test', fullName: 'Admin 1', role: 'admin' },
    { email: 'admin2@qa.test', fullName: 'Admin 2', role: 'admin' },
  ];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_bg_context');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const kinds = new ApprovalKindRegistry();
    approvals = new ApprovalsService(scratch.db, audit, kinds);
    const config = {
      getNumber: (name: string) =>
        Promise.resolve(name === 'breakGlassRecentWindowDays' ? WINDOW_DAYS : 24),
    } as unknown as SystemConfigService;
    const owners = {
      describe: () =>
        Promise.resolve({ code: 'SW-E2E-CTX', name: 'Switch', siteCode: 'E2E-HCM', orphan: false }),
    } as unknown as VaultOwnersService;
    const vault = { countFor: () => Promise.resolve(2) } as unknown as VaultService;
    const users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
      recipientsByRole: () =>
        Promise.resolve(APPROVERS.map(({ email, fullName }) => ({ email, fullName }))),
      roleByEmail: (email: string) =>
        Promise.resolve(APPROVERS.find((a) => a.email === email)?.role ?? 'member'),
    } as unknown as UsersApiService;
    const access = {
      tierFor: () => Promise.resolve('needs_approval'),
    } as unknown as AccessListService;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      new ApprovalsApiService(approvals),
      access,
      config,
      new OutboxService(scratch.db),
      owners,
      vault,
      users,
    );
    breakGlass.onModuleInit();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function request(requester: string, subjectId = randomUUID(), hours = 4) {
    return scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: 'break_glass',
        requester,
        subjectType: 'device',
        subjectId,
        reason: 'Sự cố lúc 2 giờ sáng',
        payload: { hours },
      }),
    );
  }

  async function backdate(id: string, days: number) {
    await scratch.pool.query(
      `UPDATE approval SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [id, days],
    );
  }

  it('người duyệt: vai người xin + số lần xin trong cửa sổ, tính cả phiếu đang xem', async () => {
    const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
    const old = await request(member);
    await backdate(old.id, WINDOW_DAYS + 5);
    await request(member);
    const current = await request(member);

    const view = await breakGlass.detail('sa@qa.test', true, current.id);
    expect(view.requesterRole).toBe('member');
    expect(view.recentCount).toBe(2);
    expect(view.recentWindowDays).toBe(WINDOW_DAYS);
  });

  it('người xin tự đọc phiếu của mình: không nhận ngữ cảnh của người duyệt', async () => {
    const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
    const own = await request(member);
    const view = await breakGlass.detail(member, false, own.id);
    expect(view.requesterRole).toBeNull();
    expect(view.recentCount).toBeNull();
  });

  it('phiếu đang treo: báo số người duyệt được, KHÔNG tính chính người xin', async () => {
    const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
    const subject = randomUUID();
    await request(member, subject);
    const verdict = await breakGlass.verdictFor(member, 'device', subject);
    expect(verdict.pending).not.toBeNull();
    expect(verdict.notifiedApprovers).toBe(3);

    // Admin tự xin: hai người còn lại mới là người duyệt được (bốn mắt).
    const own = randomUUID();
    await request('admin1@qa.test', own);
    const adminVerdict = await breakGlass.verdictFor('admin1@qa.test', 'device', own);
    expect(adminVerdict.notifiedApprovers).toBe(2);
  });

  it('quyền đang chạy: số giây còn lại do server tính; không có quyền thì null', async () => {
    const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
    const subject = randomUUID();
    const row = await request(member, subject, 2);
    const before = await breakGlass.verdictFor(member, 'device', subject);
    expect(before.grantSecondsLeft).toBeNull();

    await breakGlass.approve('sa@qa.test', row.id, { hours: 2 });
    const after = await breakGlass.verdictFor(member, 'device', subject);
    expect(after.notifiedApprovers).toBeNull();
    expect(after.grantSecondsLeft).toBeGreaterThan(2 * 3600 - 60);
    expect(after.grantSecondsLeft).toBeLessThanOrEqual(2 * 3600);
  });

  it('người xin thấy trần giờ cấp (để chọn nấc giờ); tầng khác không nhận', async () => {
    const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
    const verdict = await breakGlass.verdictFor(member, 'device', randomUUID());
    expect(verdict.maxGrantHours).toBe(24);
  });

  describe('lần xin gần nhất bị từ chối', () => {
    it('phiếu MỚI NHẤT của chính người xin trên đối tượng này bị từ chối: nhận giờ + ghi chú', async () => {
      const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
      const subject = randomUUID();
      const row = await request(member, subject);
      await breakGlass.deny('sa@qa.test', row.id, 'Lý do chưa đủ cụ thể');

      const verdict = await breakGlass.verdictFor(member, 'device', subject);
      expect(verdict.canRequest).toBe(true);
      expect(verdict.lastDenied?.note).toBe('Lý do chưa đủ cụ thể');
      expect(verdict.lastDenied?.at).toBeInstanceOf(Date);
    });

    it('đã gửi phiếu mới sau lần bị từ chối thì thôi nhắc', async () => {
      const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
      const subject = randomUUID();
      const denied = await request(member, subject);
      await breakGlass.deny('sa@qa.test', denied.id, 'Chưa rõ');
      const again = await request(member, subject);
      await breakGlass.cancel(member, again.id);

      const verdict = await breakGlass.verdictFor(member, 'device', subject);
      expect(verdict.lastDenied).toBeNull();
    });

    it('KHÔNG lộ lời từ chối phiếu của người khác trên cùng đối tượng', async () => {
      const other = `khac-${randomUUID().slice(0, 8)}@qa.test`;
      const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
      const subject = randomUUID();
      const theirs = await request(other, subject);
      await breakGlass.deny('sa@qa.test', theirs.id, 'Ghi chú riêng của người khác');

      const verdict = await breakGlass.verdictFor(member, 'device', subject);
      expect(verdict.lastDenied).toBeNull();
    });
  });

  describe('dòng thời gian của phiếu (trang chi tiết)', () => {
    it('người duyệt thấy từng bước: ai duyệt, ai thu hồi, lúc nào', async () => {
      const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
      const row = await request(member);
      await breakGlass.approve('sa@qa.test', row.id, { hours: 2 });
      await breakGlass.revoke('admin1@qa.test', row.id, 'Xong việc');

      const view = await breakGlass.detail('admin2@qa.test', true, row.id);
      expect(view.timeline?.map((step) => [step.state, step.actor])).toEqual([
        ['approved', 'sa@qa.test'],
        ['revoked', 'admin1@qa.test'],
      ]);
      expect(view.timeline?.[1].note).toBe('Xong việc');
      expect(view.timeline?.[0].at).toBeInstanceOf(Date);
    });

    it('người xin tự đọc phiếu của mình: không nhận dòng thời gian (tên người quyết khác)', async () => {
      const member = `xin-${randomUUID().slice(0, 8)}@qa.test`;
      const row = await request(member);
      await breakGlass.approve('sa@qa.test', row.id, { hours: 2 });
      await breakGlass.revoke('admin1@qa.test', row.id);

      const view = await breakGlass.detail(member, false, row.id);
      expect(view.timeline).toBeNull();
    });
  });
});

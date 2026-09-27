import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { BREAK_GLASS_FLOW } from '../src/modules/vault/break-glass.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bộ máy xin–duyệt trên Postgres thật. Audit là đồ giả ghi lại lời gọi — nó không nằm trên
 * đường ghi `approval` mà các bài này hỏi.
 */

const TEST_TIMEOUT = 120_000;
const KIND = BREAK_GLASS_FLOW.kind;

describe('ApprovalsService', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  const audited: { action: string; detail: Record<string, unknown> | null }[] = [];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_approvals');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const registry = new ApprovalKindRegistry();
    registry.register(BREAK_GLASS_FLOW);
    const audit = {
      appendWithin: (_tx: unknown, entry: { action: string; detail?: Record<string, unknown> }) => {
        audited.push({ action: entry.action, detail: entry.detail ?? null });
        return Promise.resolve();
      },
    } as unknown as AuditWriterService;
    approvals = new ApprovalsService(scratch.db, audit, registry);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function create(requester: string, subjectId = '00000000-0000-4000-8000-000000000001') {
    return scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: KIND,
        requester,
        subjectType: 'device',
        subjectId,
        reason: 'Sửa sự cố E2E',
      }),
    );
  }

  /**
   * BE-04 — `decision_note` là lời của NGƯỜI DUYỆT. Thu hồi ghi đè lên nó thì file nhật ký
   * nộp auditor gán lời của người thu hồi cho người duyệt.
   */
  describe('BE-04 · ghi chú thu hồi không đè ghi chú duyệt', () => {
    it('duyệt có ghi chú rồi thu hồi có ghi chú → decisionNote vẫn là lời người duyệt', async () => {
      const request = await create('member.note@pmh.com.vn');
      await approvals.transition(request.id, {
        to: 'approved',
        actor: 'duyet@pmh.com.vn',
        note: 'Cho 2 giờ',
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const revoked = await approvals.transition(request.id, {
        to: 'revoked',
        actor: 'thu.hoi@pmh.com.vn',
        note: 'Xong việc sớm',
      });

      expect(revoked.decisionNote).toBe('Cho 2 giờ');
      expect(revoked.decidedBy).toBe('duyet@pmh.com.vn');
      const history = await approvals.history(request.id);
      expect(history.map((row) => (row.detail as { note?: string }).note)).toContain('Xong việc sớm');
      expect(audited.find((row) => row.action === `${KIND}.revoked`)?.detail).toMatchObject({
        note: 'Xong việc sớm',
      });
    });

    it('duyệt KHÔNG ghi chú rồi thu hồi có ghi chú → decisionNote vẫn trống', async () => {
      const request = await create('member.note2@pmh.com.vn');
      await approvals.transition(request.id, {
        to: 'approved',
        actor: 'duyet@pmh.com.vn',
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const revoked = await approvals.transition(request.id, {
        to: 'revoked',
        actor: 'thu.hoi@pmh.com.vn',
        note: 'Xong việc sớm',
      });
      expect(revoked.decisionNote).toBeNull();
    });
  });
});

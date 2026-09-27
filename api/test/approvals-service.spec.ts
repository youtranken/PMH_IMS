import { randomUUID } from 'node:crypto';
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

  /**
   * BE-10 — nhật ký break-glass, "yêu cầu của tôi" và khối trang chủ không được tải cả lịch
   * sử rồi mới lọc/cắt trong JS: bảng chỉ lớn lên, mỗi lần mở trang chủ đọc lại toàn bộ.
   */
  describe('BE-10 · page(): lọc `since` và cắt trang trong SQL', () => {
    const requester = 'member.page@pmh.com.vn';

    beforeAll(async () => {
      // Mỗi yêu cầu một đối tượng: mỗi người chỉ được treo một yêu cầu trên một đối tượng.
      for (let i = 0; i < 5; i += 1) await create(requester, randomUUID());
      // Hai yêu cầu cũ 30 ngày — ngoài cửa sổ "tuần qua".
      const old = await create(requester, randomUUID());
      const older = await create(requester, randomUUID());
      await scratch.pool.query(
        `UPDATE approval SET created_at = now() - interval '30 days' WHERE id = ANY($1)`,
        [[old.id, older.id]],
      );
    }, TEST_TIMEOUT);

    it.each([
      { name: 'trang 1 cỡ 3', since: undefined, limit: 3, offset: 0, items: 3, total: 7 },
      { name: 'trang cuối', since: undefined, limit: 3, offset: 6, items: 1, total: 7 },
      { name: 'chỉ 7 ngày qua', since: 7, limit: 50, offset: 0, items: 5, total: 5 },
      { name: '7 ngày qua, cắt 2', since: 7, limit: 2, offset: 0, items: 2, total: 5 },
    ])('$name → $items dòng, total $total', async ({ since, limit, offset, items, total }) => {
      const result = await approvals.page(
        {
          kind: KIND,
          requester,
          since: since === undefined ? undefined : new Date(Date.now() - since * 86_400_000),
        },
        { limit, offset },
      );
      expect(result.items).toHaveLength(items);
      expect(result.total).toBe(total);
    });

    it('mới nhất lên đầu', async () => {
      const { items } = await approvals.page({ kind: KIND, requester }, { limit: 50, offset: 0 });
      const times = items.map((row) => row.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });
  });
});

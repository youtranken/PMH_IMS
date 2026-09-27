import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import { pgConstraint } from '../src/common/sql';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { BREAK_GLASS_FLOW } from '../src/modules/vault/break-glass.service';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * Máy trạng thái xin–duyệt (AD-6) trên DB thật, chạy bằng từ vựng break-glass thật.
 *
 * Bảng `approval` cố ý không có CHECK cho `state`, nên luật chỉ sống ở `transitionWithin`;
 * còn "hai người cùng quyết" và "một yêu cầu treo" là hành vi của khoá hàng và chỉ mục một
 * phần của Postgres — đồ giả không hỏi được.
 */

const TEST_TIMEOUT = 120_000;
const KIND = BREAK_GLASS_FLOW.kind;
const ONE_SUBJECT = randomUUID();

describe('ApprovalsService — máy trạng thái, tầng DB', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_approvals');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const kinds = new ApprovalKindRegistry();
    kinds.register(BREAK_GLASS_FLOW);
    approvals = new ApprovalsService(scratch.db, audit, kinds);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function request(subjectId: string = randomUUID(), requester = 'xin@qa.test') {
    return scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: KIND,
        requester,
        subjectType: 'device',
        subjectId,
        reason: 'Sự cố lúc 2 giờ sáng',
      }),
    );
  }

  async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return ((error as BadRequestException).getResponse() as { code?: string }).code;
    }
  }

  async function historyStates(id: string): Promise<[string | null, string][]> {
    const { rows } = await scratch.pool.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state FROM approval_history WHERE approval_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return rows.map((r) => [r.from_state, r.to_state]);
  }

  it('gửi yêu cầu: state khởi tạo, có dòng lịch sử; lý do trống bị từ chối', async () => {
    const created = await request();
    expect(created.state).toBe('pending');
    expect(created.active).toBe(false);
    expect(await historyStates(created.id)).toEqual([[null, 'pending']]);

    expect(
      await errorCode(
        scratch.db.transaction((tx) =>
          approvals.createWithin(tx, {
            kind: KIND,
            requester: 'x@qa.test',
            subjectType: 'device',
            subjectId: randomUUID(),
            reason: '   ',
          }),
        ),
      ),
    ).toBe('APPROVAL_REASON_REQUIRED');
    expect(
      await errorCode(
        scratch.db.transaction((tx) =>
          approvals.createWithin(tx, {
            kind: 'khong_co',
            requester: 'x@qa.test',
            subjectType: 'device',
            subjectId: randomUUID(),
            reason: 'x',
          }),
        ),
      ),
    ).toBe('APPROVAL_KIND_UNKNOWN');
  });

  it('duyệt → thu hồi: đóng dấu người quyết một lần, grant tắt ngay khi thu hồi', async () => {
    const r = await request();
    const expiresAt = new Date(Date.now() + 3_600_000);
    const approved = await approvals.transition(r.id, {
      to: 'approved',
      actor: 'duyet@qa.test',
      note: 'Ok',
      expiresAt,
    });
    expect(approved).toMatchObject({ state: 'approved', decidedBy: 'duyet@qa.test', active: true });
    expect(
      await approvals.activeGrantFor({
        kind: KIND,
        requester: 'xin@qa.test',
        subjectType: 'device',
        subjectId: r.subjectId,
      }),
    ).toMatchObject({ id: r.id });

    const revoked = await approvals.transition(r.id, { to: 'revoked', actor: 'sa@qa.test' });
    expect(revoked).toMatchObject({ state: 'revoked', decidedBy: 'duyet@qa.test', active: false });
    expect(
      await approvals.activeGrantFor({
        kind: KIND,
        requester: 'xin@qa.test',
        subjectType: 'device',
        subjectId: r.subjectId,
      }),
    ).toBeNull();
    expect(await historyStates(r.id)).toEqual([
      [null, 'pending'],
      ['pending', 'approved'],
      ['approved', 'revoked'],
    ]);
  });

  it('từ chối là trạng thái cuối; bước chuyển ngoài sổ bị chặn và không để lại vết', async () => {
    const r = await request();
    await approvals.transition(r.id, { to: 'denied', actor: 'duyet@qa.test' });
    expect(
      await errorCode(approvals.transition(r.id, { to: 'approved', actor: 'duyet@qa.test' })),
    ).toBe('APPROVAL_TRANSITION_INVALID');

    const other = await request();
    expect(
      await errorCode(approvals.transition(other.id, { to: 'revoked', actor: 'sa@qa.test' })),
    ).toBe('APPROVAL_TRANSITION_INVALID');
    expect((await approvals.findOne(other.id)).state).toBe('pending');
    expect(await historyStates(other.id)).toEqual([[null, 'pending']]);
  });

  it('hai người cùng quyết song song: người sau nhận APPROVAL_ALREADY_DECIDED, không ghi đè', async () => {
    const r = await request();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstWrote!: () => void;
    const wrote = new Promise<void>((resolve) => (firstWrote = resolve));

    const first = scratch.db.transaction(async (tx) => {
      const out = await approvals.transitionWithin(tx, r.id, {
        to: 'approved',
        actor: 'a@qa.test',
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      firstWrote();
      await gate;
      return out;
    });
    await wrote;
    // Người sau đọc "pending" (lượt đầu chưa commit) rồi đứng chờ khoá hàng ở câu UPDATE.
    const second = approvals.transition(r.id, { to: 'denied', actor: 'b@qa.test' });
    try {
      await waitForLock(scratch.pool, 5_000);
    } finally {
      release();
    }

    await first;
    expect(await errorCode(second)).toBe('APPROVAL_ALREADY_DECIDED');
    const final = await approvals.findOne(r.id);
    expect(final).toMatchObject({ state: 'approved', decidedBy: 'a@qa.test' });
    expect(await historyStates(r.id)).toEqual([
      [null, 'pending'],
      ['pending', 'approved'],
    ]);
  });

  it('mỗi người chỉ một yêu cầu treo cho một đối tượng (0025); đã quyết xong thì xin lại được', async () => {
    const r = await request(ONE_SUBJECT, 'mot@qa.test');
    let violated: string | undefined;
    try {
      await request(ONE_SUBJECT, 'mot@qa.test');
    } catch (error) {
      violated = pgConstraint(error);
    }
    expect(violated).toBe('approval_one_pending_key');

    // Người khác, cùng đối tượng: không đụng.
    await request(ONE_SUBJECT, 'khac@qa.test');

    await approvals.transition(r.id, { to: 'cancelled', actor: 'mot@qa.test' });
    await request(ONE_SUBJECT, 'mot@qa.test');
  });

  it('quét hết hạn: chỉ đóng grant đã quá hạn, giữ tên người duyệt, đếm đúng số đã đóng', async () => {
    const past = await request();
    const future = await request();
    const now = new Date();
    await approvals.transition(past.id, {
      to: 'approved',
      actor: 'duyet@qa.test',
      expiresAt: new Date(now.getTime() + 1_000),
    });
    await approvals.transition(future.id, {
      to: 'approved',
      actor: 'duyet@qa.test',
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    // Loại không còn đăng ký thì bỏ qua chứ không làm chết cả vòng quét.
    await scratch.pool.query(
      `INSERT INTO approval (kind, state, requester, subject_type, subject_id, reason, expires_at)
       VALUES ('loai_da_bo', 'approved', 'x@qa.test', 'device', gen_random_uuid(), 'x', now() - interval '1 day')`,
    );

    const sweepAt = new Date(now.getTime() + 60_000);
    expect(await approvals.expireDueGrants(sweepAt)).toBe(1);
    expect(await approvals.findOne(past.id)).toMatchObject({
      state: 'expired',
      decidedBy: 'duyet@qa.test',
    });
    expect((await approvals.findOne(future.id)).state).toBe('approved');
    const { rows } = await scratch.pool.query<{ actor: string }>(
      `SELECT actor FROM approval_history WHERE approval_id = $1 AND to_state = 'expired'`,
      [past.id],
    );
    expect(rows).toEqual([{ actor: 'system' }]);

    // Chạy lại không đóng lần hai.
    expect(await approvals.expireDueGrants(sweepAt)).toBe(0);
  });

  it('chốt lượt nhắc nguyên tử: chỉ lượt đầu chốt được, yêu cầu đã quyết thì không nhắc', async () => {
    const r = await request();
    const now = new Date();
    const claims = await Promise.all([
      approvals.runInTransaction((tx) => approvals.claimReminderWithin(tx, r.id, now)),
      approvals.runInTransaction((tx) => approvals.claimReminderWithin(tx, r.id, now)),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await approvals.findOne(r.id)).payload).toMatchObject({
      remindedAt: now.toISOString(),
    });

    const decided = await request();
    await approvals.transition(decided.id, { to: 'denied', actor: 'duyet@qa.test' });
    expect(
      await approvals.runInTransaction((tx) => approvals.claimReminderWithin(tx, decided.id, now)),
    ).toBe(false);
  });
});

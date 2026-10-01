import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { AccountsService } from '../src/modules/auth/accounts.service';
import { AuthApiService } from '../src/modules/auth/auth.api';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { UsersService } from '../src/modules/users/users.service';
import { BreakGlassService } from '../src/modules/vault/break-glass.service';
import type { AccessListService } from '../src/modules/vault/access-list.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-15 — quyền mở két gắn với PHIÊN đã xem nó lần đầu.
 *
 * Hai đòn cần chặn cùng lúc:
 *   1. Người xin được duyệt 24 giờ trên máy trực, đăng xuất rồi về nhà; ai đó (hoặc chính họ ở
 *      máy khác) đăng nhập bằng tài khoản đó và mở két bằng quyền còn giờ. Quyền xem mật khẩu
 *      không được sống lâu hơn phiên đang ngồi trước máy.
 *   2. Ngược lại, việc CHỜ duyệt không được bắt người xin canh trang: phiên idle chết sau 30
 *      phút, còn người duyệt có thể quyết sau `approval.reminder_hours` giờ. Yêu cầu đang chờ vì
 *      thế không gắn phiên; được duyệt thì LẦN XEM ĐẦU TIÊN (đã qua mã 6 số) gắn grant vào phiên
 *      đang xem, và từ đó chỉ phiên ấy dùng được.
 *
 * Chạy trên Postgres thật với phiên THẬT trong bảng `sessions`: "phiên chết" ở đây là đúng
 * những gì đăng xuất / hết idle ghi xuống DB, không phải một cờ giả.
 */

const TEST_TIMEOUT = 120_000;
const IDLE_MINUTES = 30;
const PENDING_EXPIRE_HOURS = 8;
const REMINDER_HOURS = 4;
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Break-glass · quyền gắn với phiên đã xem (Q-15)', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let sessions: SessionService;
  let breakGlass: BreakGlassService;
  let accounts: AccountsService;
  let sweepJobs: Map<string, () => Promise<unknown>>;
  let userId: string;
  const auditLog: { actor: string; action: string; objectId: string }[] = [];
  const member = 'e2e-q15-member@qa.test';
  const other = 'e2e-q15-other@qa.test';
  const sa = 'sa@qa.test';

  beforeAll(async () => {
    scratch = await createScratchDb('ims_bg_session');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = {
      appendWithin: (_tx: unknown, entry: { actor: string; action: string; objectId: string }) => {
        auditLog.push(entry);
        return Promise.resolve();
      },
    } as unknown as AuditWriterService;
    const kinds = new ApprovalKindRegistry();
    approvals = new ApprovalsService(scratch.db, audit, kinds);
    const numbers: Record<string, number> = {
      sessionIdleMinutes: IDLE_MINUTES,
      breakGlassPendingExpireHours: PENDING_EXPIRE_HOURS,
      approvalReminderHours: REMINDER_HOURS,
    };
    const config = {
      getNumber: (key: string) => Promise.resolve(numbers[key] ?? 24),
    } as unknown as SystemConfigService;
    sessions = new SessionService(scratch.db, config, noopSweep);
    sweepJobs = new Map();
    const sweep = {
      register: (job: { name: string; run: () => Promise<unknown> }) => {
        sweepJobs.set(job.name, job.run);
      },
    } as unknown as SweepService;
    const users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
      recipientsByRole: () => Promise.resolve([{ email: sa, fullName: 'SA' }]),
    } as unknown as UsersApiService;
    const approvalsApi = new ApprovalsApiService(approvals);
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      approvalsApi,
      { tierFor: () => Promise.resolve('needs_approval') } as unknown as AccessListService,
      config,
      new OutboxService(scratch.db, config, noopSweep),
      { describe: () => Promise.resolve({ orphan: true }) } as unknown as VaultOwnersService,
      { countFor: () => Promise.resolve(0) } as unknown as VaultService,
      users,
      new AuthApiService(sessions, config),
      sweep,
    );
    breakGlass.onModuleInit();
    accounts = new AccountsService(
      scratch.db,
      new UsersService(scratch.db),
      sessions,
      new PasswordService('p'.repeat(64)),
      new AuditWriterService(scratch.db),
      new OutboxService(scratch.db, config, noopSweep),
      new LoginFailureService(scratch.db, config, noopSweep),
      approvalsApi,
      config,
    );
    const rows = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ($1, 'Q15 Member', 'member', 'x', false) RETURNING id`,
      [member],
    );
    userId = rows.rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function login(forUser = userId): Promise<string> {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, {
        userId: forUser,
        ip: '10.0.0.1',
        userAgent: 'jest',
        absoluteHours: 12,
        totpPending: false,
      }),
    );
    return created.id;
  }

  function logout(sessionId: string) {
    return scratch.db.transaction((tx) => sessions.revokeWithin(tx, sessionId, 'logout'));
  }

  function idleOut(sessionId: string) {
    return scratch.pool.query(
      `UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [sessionId, IDLE_MINUTES + 1],
    );
  }

  const as = (sessionId: string, email = member) => ({ email, sessionId });

  function ask(sessionId: string, subject = randomUUID(), email = member) {
    return breakGlass.request(as(sessionId, email), {
      ownerType: 'device',
      ownerId: subject,
      reason: 'Sự cố lúc 2 giờ sáng',
      hours: 4,
    });
  }

  /** Xin + duyệt, CHƯA xem lần nào — grant chưa gắn phiên. */
  async function approved(sessionId: string, subject = randomUUID()) {
    const req = await ask(sessionId, subject);
    await breakGlass.approve(sa, req.id, { hours: 4 });
    return { id: req.id, subject };
  }

  /** Xin + duyệt + xem lần đầu ở đúng phiên đó (grant gắn vào phiên này). */
  async function held(sessionId: string, subject = randomUUID()) {
    const grant = await approved(sessionId, subject);
    await breakGlass.assertCanReveal(as(sessionId), 'device', subject);
    return grant;
  }

  async function row(id: string) {
    const { rows } = await scratch.pool.query<{
      state: string;
      claimed_session_id: string | null;
      claimed_at: Date | null;
    }>(`SELECT state, claimed_session_id, claimed_at FROM approval WHERE id = $1`, [id]);
    return rows[0];
  }

  async function stateOf(id: string): Promise<string> {
    return (await row(id)).state;
  }

  async function runSweep(name = 'break-glass-session-ended') {
    const job = sweepJobs.get(name);
    if (!job) throw new Error(`Chưa cắm lượt quét ${name} vào sweep`);
    await job();
  }

  const REQUIRED = { response: { code: 'BREAK_GLASS_REQUIRED' } };
  const OTHER_SESSION = { status: 403, response: { code: 'BREAK_GLASS_OTHER_SESSION' } };

  describe('yêu cầu đang chờ KHÔNG gắn phiên', () => {
    it('phiên A xin → A chết → vẫn chờ → duyệt → phiên B xem lần đầu và mở được', async () => {
      const a = await login();
      const subject = randomUUID();
      const req = await ask(a, subject);
      await logout(a);
      await runSweep();
      expect(await stateOf(req.id)).toBe('pending');

      // Phiên mới thấy yêu cầu vẫn đang chờ, không bị mời xin lại.
      const b = await login();
      const waiting = await breakGlass.verdictFor(as(b), 'device', subject);
      expect(waiting.pending?.id).toBe(req.id);
      expect(waiting.canRequest).toBe(false);

      await breakGlass.approve(sa, req.id, { hours: 4 });
      const ready = await breakGlass.verdictFor(as(b), 'device', subject);
      expect(ready.claimable?.id).toBe(req.id);
      expect(ready.canReveal).toBe(true);
      expect(ready.canRequest).toBe(false);

      await expect(breakGlass.assertCanReveal(as(b), 'device', subject)).resolves.toEqual({
        tier: 'needs_approval',
        grantId: req.id,
      });
      const after = await breakGlass.verdictFor(as(b), 'device', subject);
      expect(after.canReveal).toBe(true);
      expect(after.claimable).toBeNull();
      expect(after.grant?.id).toBe(req.id);
    });

    it('phiên hết idle khi đang chờ: lượt quét không rút, badge người duyệt giữ nguyên', async () => {
      const idle = await login();
      const before = await breakGlass.pendingCountFor(sa);
      const req = await ask(idle);
      await idleOut(idle);
      await runSweep();
      expect(await stateOf(req.id)).toBe('pending');
      expect(await breakGlass.pendingCountFor(sa)).toBe(before + 1);
    });

    it('cùng người gửi hai lần cho cùng đối tượng — từ hai phiên — vẫn là "đang chờ"', async () => {
      const a = await login();
      const b = await login();
      const subject = randomUUID();
      await ask(a, subject);
      await expect(ask(b, subject)).rejects.toMatchObject({
        response: { code: 'BREAK_GLASS_PENDING' },
      });
    });
  });

  describe('lần xem đầu tiên gắn quyền vào phiên', () => {
    it('gắn phiên đang xem + lúc gắn, có audit và dòng lịch sử; xem lại không ghi thêm', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await breakGlass.assertCanReveal(as(a), 'device', subject);
      const stored = await row(id);
      expect(stored.state).toBe('approved');
      expect(stored.claimed_session_id).toBe(a);
      expect(stored.claimed_at).not.toBeNull();

      await breakGlass.assertCanReveal(as(a), 'device', subject);
      expect(
        auditLog.filter((e) => e.action === 'break_glass.claimed' && e.objectId === id),
      ).toEqual([expect.objectContaining({ actor: member })]);
      const { rows } = await scratch.pool.query<{ actor: string }>(
        `SELECT actor FROM approval_history WHERE approval_id = $1 AND detail->>'event' = 'claimed'`,
        [id],
      );
      expect(rows).toEqual([{ actor: member }]);
    });

    it('hỏi verdict KHÔNG gắn phiên — chỉ lượt xem thật mới gắn', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await breakGlass.verdictFor(as(a), 'device', subject);
      expect((await row(id)).claimed_session_id).toBeNull();
    });

    it('đã gắn ở B: phiên C (và A) cùng người bị từ chối rõ ràng, được xin lại', async () => {
      const a = await login();
      const b = await login();
      const c = await login();
      const { id, subject } = await approved(a);
      await breakGlass.assertCanReveal(as(b), 'device', subject);

      await expect(breakGlass.assertCanReveal(as(c), 'device', subject)).rejects.toMatchObject(
        OTHER_SESSION,
      );
      await expect(breakGlass.assertCanReveal(as(a), 'device', subject)).rejects.toMatchObject(
        OTHER_SESSION,
      );
      expect((await row(id)).claimed_session_id).toBe(b);

      const fromC = await breakGlass.verdictFor(as(c), 'device', subject);
      expect(fromC.canReveal).toBe(false);
      expect(fromC.claimable).toBeNull();
      expect(fromC.otherSessionHeld).toBe(true);
      expect(fromC.canRequest).toBe(true);
    });

    it('hai phiên xem lần đầu cùng lúc: đúng MỘT phiên thắng, phiên kia bị từ chối', async () => {
      const a = await login();
      const b = await login();
      const { id, subject } = await approved(a);
      const results = await Promise.allSettled([
        breakGlass.assertCanReveal(as(a), 'device', subject),
        breakGlass.assertCanReveal(as(b), 'device', subject),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toMatchObject(OTHER_SESSION);
      expect([a, b]).toContain((await row(id)).claimed_session_id);
    });

    it('hết giờ (tính từ lúc duyệt) thì không gắn được, dù sweep chưa đổi trạng thái', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await scratch.pool.query(
        `UPDATE approval SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );
      await expect(breakGlass.assertCanReveal(as(a), 'device', subject)).rejects.toMatchObject(
        REQUIRED,
      );
      expect((await row(id)).claimed_session_id).toBeNull();
    });

    it('bị thu hồi trước lần xem đầu thì không gắn được', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await breakGlass.revoke(sa, id, 'Không còn trực');
      await expect(breakGlass.assertCanReveal(as(a), 'device', subject)).rejects.toMatchObject(
        REQUIRED,
      );
      expect((await row(id)).claimed_session_id).toBeNull();
    });

    it('grant của NGƯỜI KHÁC không gắn vào phiên của mình', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await expect(
        breakGlass.assertCanReveal(as(randomUUID(), other), 'device', subject),
      ).rejects.toMatchObject(REQUIRED);
      expect((await row(id)).claimed_session_id).toBeNull();
    });

    it('phiên đã chết không gắn được (lớp thứ hai sau SessionGuard)', async () => {
      const a = await login();
      const dead = await login();
      const { id, subject } = await approved(a);
      await logout(dead);
      await expect(breakGlass.assertCanReveal(as(dead), 'device', subject)).rejects.toMatchObject(
        REQUIRED,
      );
      expect((await row(id)).claimed_session_id).toBeNull();
    });

    it('đếm lùi của quyền chưa xem tính từ lúc duyệt, không từ lần xem đầu', async () => {
      const a = await login();
      const { id, subject } = await approved(a);
      await scratch.pool.query(
        `UPDATE approval SET expires_at = now() + interval '1 hour' WHERE id = $1`,
        [id],
      );
      const ready = await breakGlass.verdictFor(as(a), 'device', subject);
      expect(ready.grantSecondsLeft).toBeGreaterThan(3600 - 60);
      expect(ready.grantSecondsLeft).toBeLessThanOrEqual(3600);
      await breakGlass.assertCanReveal(as(a), 'device', subject);
      const after = await breakGlass.verdictFor(as(a), 'device', subject);
      expect(after.grantSecondsLeft).toBeLessThanOrEqual(3600);
    });
  });

  describe('không xin chồng khi quyền còn dùng được (BE-17)', () => {
    it('đã duyệt, chưa xem ở phiên nào → 409 BREAK_GLASS_APPROVED, không sinh phiếu mới', async () => {
      const a = await login();
      const { subject } = await approved(a);
      await expect(ask(a, subject)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_APPROVED' },
      });
      const { rows } = await scratch.pool.query(
        `SELECT 1 FROM approval WHERE subject_id = $1`,
        [subject],
      );
      expect(rows).toHaveLength(1);
    });

    it('đang cầm quyền đã gắn CHÍNH phiên này → 409 BREAK_GLASS_ACTIVE', async () => {
      const a = await login();
      const { subject } = await held(a);
      await expect(ask(a, subject)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_ACTIVE' },
      });
      const { rows } = await scratch.pool.query(
        `SELECT 1 FROM approval WHERE subject_id = $1`,
        [subject],
      );
      expect(rows).toHaveLength(1);
    });

    it('quyền gắn phiên KHÁC không chặn: phiên này vẫn xin lại được (Q-15)', async () => {
      const a = await login();
      const b = await login();
      const { subject } = await held(a);
      await expect(ask(b, subject)).resolves.toMatchObject({ state: 'pending' });
    });
  });

  describe('quyền đã gắn chết cùng phiên', () => {
    it('B đăng xuất → hết ngay; lượt quét ghi hết hiệu lực + nhật ký', async () => {
      const b = await login();
      const { id, subject } = await held(b);
      await logout(b);
      await expect(breakGlass.assertCanReveal(as(b), 'device', subject)).rejects.toMatchObject(
        REQUIRED,
      );

      await runSweep();
      expect(await stateOf(id)).toBe('expired');
      const { rows } = await scratch.pool.query<{ actor: string; detail: { note?: string; by?: string } }>(
        `SELECT actor, detail FROM approval_history WHERE approval_id = $1 AND to_state = 'expired'`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe('system');
      expect(rows[0].detail.note).toMatch(/phiên đăng nhập/i);
      expect(rows[0].detail.by).toBe('session-ended');
      expect(auditLog).toContainEqual(
        expect.objectContaining({ actor: 'system', action: 'break_glass.expired', objectId: id }),
      );
    });

    it('B hết idle → hết; phiên còn sống và grant chưa xem thì lượt quét không đụng', async () => {
      const idle = await login();
      const alive = await login();
      const dead = await held(idle);
      const live = await held(alive);
      const waiting = await approved(idle);
      await idleOut(idle);

      await expect(
        breakGlass.assertCanReveal(as(idle), 'device', dead.subject),
      ).rejects.toMatchObject(REQUIRED);

      await runSweep();
      expect(await stateOf(dead.id)).toBe('expired');
      expect(await stateOf(live.id)).toBe('approved');
      // Chưa xem thì chưa gắn phiên nào: người xin mở ở phiên mới vẫn được.
      expect(await stateOf(waiting.id)).toBe('approved');
      const fresh = await login();
      await expect(
        breakGlass.assertCanReveal(as(fresh), 'device', waiting.subject),
      ).resolves.toMatchObject({ grantId: waiting.id });
    });

    it('phiên mới sau khi quyền cũ hết: được xin lại', async () => {
      const b = await login();
      const { subject } = await held(b);
      await logout(b);
      await runSweep();
      const c = await login();
      const verdict = await breakGlass.verdictFor(as(c), 'device', subject);
      expect(verdict.canRequest).toBe(true);
      expect(verdict.otherSessionHeld).toBe(false);
    });
  });

  describe(`yêu cầu chờ quá ${PENDING_EXPIRE_HOURS} giờ tự hết hạn`, () => {
    async function aged(minutes: number, subject = randomUUID()) {
      const s = await login();
      const req = await ask(s, subject);
      await scratch.pool.query(
        `UPDATE approval SET created_at = now() - make_interval(mins => $2) WHERE id = $1`,
        [req.id, minutes],
      );
      return { ...req, session: s, subject };
    }
    const OVER = PENDING_EXPIRE_HOURS * 60 + 5;
    const UNDER = PENDING_EXPIRE_HOURS * 60 - 30;

    it('quá hạn chờ → hết hạn (không phải "rút"), có lịch sử + audit + thư báo người xin', async () => {
      const old = await aged(OVER);
      const young = await aged(UNDER);
      await runSweep('break-glass-pending-expire');

      expect(await stateOf(old.id)).toBe('expired');
      expect(await stateOf(young.id)).toBe('pending');
      const { rows } = await scratch.pool.query<{ actor: string; detail: { note?: string; by?: string } }>(
        `SELECT actor, detail FROM approval_history WHERE approval_id = $1 AND to_state = 'expired'`,
        [old.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe('system');
      expect(rows[0].detail.note).toBe(`Quá ${PENDING_EXPIRE_HOURS} giờ không ai duyệt.`);
      expect(rows[0].detail.by).toBe('pending-timeout');
      expect(auditLog).toContainEqual(
        expect.objectContaining({ actor: 'system', action: 'break_glass.expired', objectId: old.id }),
      );
      const mail = await scratch.pool.query<{ payload: { state: string } }>(
        `SELECT payload FROM outbox WHERE topic = 'approval.decided' AND payload->>'approvalId' = $1`,
        [old.id],
      );
      expect(mail.rows.map((r) => r.payload.state)).toEqual(['expired']);
    });

    it('người duyệt bấm Duyệt phiếu đã hết hạn chờ → 409 nói rõ', async () => {
      const old = await aged(OVER);
      await runSweep('break-glass-pending-expire');
      await expect(breakGlass.approve(sa, old.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'BREAK_GLASS_PENDING_EXPIRED',
          message: expect.stringMatching(/không ai duyệt/i),
        },
      });
      expect(await stateOf(old.id)).toBe('expired');
    });

    it('quá hạn theo đồng hồ mà lượt quét chưa chạy: Duyệt cũng bị chặn (AD-6)', async () => {
      const old = await aged(OVER);
      await expect(breakGlass.approve(sa, old.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_PENDING_EXPIRED' },
      });
      expect(await stateOf(old.id)).toBe('pending');
    });

    it('người xin: sau khi hết hạn chờ thì xin lại được', async () => {
      const old = await aged(OVER);
      await runSweep('break-glass-pending-expire');
      const verdict = await breakGlass.verdictFor(as(old.session), 'device', old.subject);
      expect(verdict.pending).toBeNull();
      expect(verdict.canRequest).toBe(true);
    });
  });

  describe('người duyệt gặp phiếu đã rút', () => {
    it('người xin TỰ rút: Duyệt / Từ chối nhận 409 "đã rút", không phải lỗi chung', async () => {
      const a = await login();
      const p1 = await ask(a);
      await breakGlass.cancel(member, p1.id);
      await expect(breakGlass.approve(sa, p1.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'BREAK_GLASS_WITHDRAWN',
          message: expect.stringMatching(/người xin đã rút/i),
        },
      });
      await expect(breakGlass.deny(sa, p1.id, 'Không cần nữa')).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_WITHDRAWN' },
      });
    });
  });

  describe('vô hiệu hóa tài khoản rút yêu cầu đang chờ', () => {
    async function freshMember(): Promise<{ id: string; email: string }> {
      const email = `e2e-q15-off-${randomUUID().slice(0, 8)}@qa.test`;
      const { rows } = await scratch.pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
         VALUES ($1, 'Q15 Off', 'member', 'x', false) RETURNING id`,
        [email],
      );
      return { id: rows[0].id, email };
    }

    it('mọi yêu cầu đang chờ của người đó bị rút cùng lúc, có lịch sử + audit; người khác không bị đụng', async () => {
      const off = await freshMember();
      const s = await login(off.id);
      const p1 = await ask(s, randomUUID(), off.email);
      const p2 = await ask(s, randomUUID(), off.email);
      const theirs = await ask(await login(), randomUUID(), member);

      await accounts.setStatus({ id: randomUUID(), email: sa }, off.id, 'disabled', 'Nghỉ việc');

      expect(await stateOf(p1.id)).toBe('cancelled');
      expect(await stateOf(p2.id)).toBe('cancelled');
      expect(await stateOf(theirs.id)).toBe('pending');
      const { rows } = await scratch.pool.query<{ actor: string; detail: { by?: string; note?: string } }>(
        `SELECT actor, detail FROM approval_history WHERE approval_id = $1 AND to_state = 'cancelled'`,
        [p1.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe(sa);
      expect(rows[0].detail.by).toBe('account-disabled');
      expect(rows[0].detail.note).toMatch(/vô hiệu hóa/i);
      expect(auditLog).toContainEqual(
        expect.objectContaining({ actor: sa, action: 'break_glass.cancelled', objectId: p2.id }),
      );
      const audit = await scratch.pool.query<{ detail: { withdrawnRequests?: number } }>(
        `SELECT detail FROM audit_log WHERE object_id = $1 AND action = 'account.disabled'`,
        [off.id],
      );
      expect(audit.rows[0].detail.withdrawnRequests).toBe(2);

      // Người duyệt mở đúng phiếu đó: 409 nói rõ vì sao.
      await expect(breakGlass.approve(sa, p1.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'BREAK_GLASS_WITHDRAWN',
          message: expect.stringMatching(/vô hiệu hóa/i),
        },
      });
    });

    it('quyền đã duyệt (chưa xem lẫn đã xem) bị thu hồi luôn: bật lại tài khoản cũng không mở được', async () => {
      const off = await freshMember();
      const s = await login(off.id);
      const unclaimed = await ask(s, randomUUID(), off.email);
      await breakGlass.approve(sa, unclaimed.id, { hours: 4 });
      const claimedSubject = randomUUID();
      const claimed = await ask(s, claimedSubject, off.email);
      await breakGlass.approve(sa, claimed.id, { hours: 4 });
      await breakGlass.assertCanReveal(as(s, off.email), 'device', claimedSubject);

      await accounts.setStatus({ id: randomUUID(), email: sa }, off.id, 'disabled', 'Nghi lộ');

      expect(await stateOf(unclaimed.id)).toBe('revoked');
      expect(await stateOf(claimed.id)).toBe('revoked');
      const audit = await scratch.pool.query<{ detail: { withdrawnRequests?: number } }>(
        `SELECT detail FROM audit_log WHERE object_id = $1 AND action = 'account.disabled'`,
        [off.id],
      );
      expect(audit.rows[0].detail.withdrawnRequests).toBe(2);

      await accounts.setStatus({ id: randomUUID(), email: sa }, off.id, 'active');
      const again = await login(off.id);
      await expect(
        breakGlass.assertCanReveal(as(again, off.email), 'device', unclaimed.subjectId),
      ).rejects.toMatchObject(REQUIRED);
    });

    it('chỉ KHÓA (không vô hiệu hóa) thì yêu cầu vẫn chờ', async () => {
      const off = await freshMember();
      const p1 = await ask(await login(off.id), randomUUID(), off.email);
      await accounts.setStatus({ id: randomUUID(), email: sa }, off.id, 'locked', 'Nghi lộ');
      expect(await stateOf(p1.id)).toBe('pending');
    });

    it('rút nằm TRONG transaction vô hiệu hóa: vô hiệu hóa hỏng thì yêu cầu vẫn chờ', async () => {
      const off = await freshMember();
      const p1 = await ask(await login(off.id), randomUUID(), off.email);
      // Không được vô hiệu hóa SA cuối cùng — transaction phải rollback cả phần rút.
      await scratch.pool.query(`UPDATE users SET status = 'disabled' WHERE role = 'sa'`);
      await scratch.pool.query(`UPDATE users SET role = 'sa' WHERE id = $1`, [off.id]);
      await expect(
        accounts.setStatus({ id: randomUUID(), email: sa }, off.id, 'disabled'),
      ).rejects.toBeDefined();
      expect(await stateOf(p1.id)).toBe('pending');
      await scratch.pool.query(`UPDATE users SET role = 'member' WHERE id = $1`, [off.id]);
    });
  });

  it('hàng chờ của người duyệt đánh dấu phiếu chờ quá `approval.reminder_hours` (VLT-017)', async () => {
    const a = await login();
    const fresh = await ask(a);
    const old = await ask(a);
    await scratch.pool.query(
      `UPDATE approval SET created_at = now() - make_interval(hours => $2) WHERE id = $1`,
      [old.id, REMINDER_HOURS + 1],
    );
    const rows = await breakGlass.pendingForApprovers();
    expect(rows.find((r) => r.id === fresh.id)?.overdue).toBe(false);
    expect(rows.find((r) => r.id === old.id)?.overdue).toBe(true);
  });

  it('nhóm "Đang có hiệu lực" chỉ gồm quyền đã duyệt còn giờ (VLT-020)', async () => {
    const a = await login();
    const live = await held(a);
    const released = await held(a);
    await breakGlass.release(member, released.id);
    const timedOut = await held(a);
    await scratch.pool.query(
      `UPDATE approval SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [timedOut.id],
    );
    const ids = (await breakGlass.activeGrants()).map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(released.id);
    expect(ids).not.toContain(timedOut.id);
  });

  describe('người xin tự trả quyền (VLT-055)', () => {
    it('trả grant đã gắn: hết ngay, không mở được nữa', async () => {
      const a = await login();
      const { id, subject } = await held(a);
      const released = await breakGlass.release(member, id);
      expect(released.state).toBe('revoked');
      await expect(breakGlass.assertCanReveal(as(a), 'device', subject)).rejects.toMatchObject(
        REQUIRED,
      );
      const { rows } = await scratch.pool.query<{ actor: string }>(
        `SELECT actor FROM approval_history WHERE approval_id = $1 AND to_state = 'revoked'`,
        [id],
      );
      expect(rows.map((r) => r.actor)).toEqual([member]);
    });

    it('trả grant chưa xem lần nào cũng được', async () => {
      const a = await login();
      const { id } = await approved(a);
      await breakGlass.release(member, id);
      expect(await stateOf(id)).toBe('revoked');
    });

    it('trả grant của NGƯỜI KHÁC bị chặn, grant vẫn nguyên', async () => {
      const a = await login();
      const { id, subject } = await held(a);
      await expect(breakGlass.release(other, id)).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_REQUEST' },
      });
      expect(await stateOf(id)).toBe('approved');
      await expect(breakGlass.assertCanReveal(as(a), 'device', subject)).resolves.toMatchObject({
        grantId: id,
      });
    });

    it('phiếu chưa được duyệt thì không "trả" được (dùng Hủy yêu cầu)', async () => {
      const a = await login();
      const req = await ask(a);
      await expect(breakGlass.release(member, req.id)).rejects.toMatchObject({
        response: { code: 'APPROVAL_TRANSITION_INVALID' },
      });
      expect(await stateOf(req.id)).toBe('pending');
    });
  });
});

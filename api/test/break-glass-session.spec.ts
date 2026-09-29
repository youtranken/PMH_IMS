import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { AuthApiService } from '../src/modules/auth/auth.api';
import { SessionService } from '../src/modules/auth/session.service';
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
 * Q-15 — quyền mở két gắn với PHIÊN đăng nhập đã gửi yêu cầu.
 *
 * Đòn cần chặn: người xin được duyệt 24 giờ trên máy trực, đăng xuất rồi về nhà; ai đó (hoặc
 * chính họ trên một máy khác) đăng nhập bằng tài khoản đó và mở két bằng quyền còn giờ. Quyền
 * xem mật khẩu không được sống lâu hơn người đang ngồi trước máy đã xin.
 *
 * Chạy trên Postgres thật với phiên THẬT trong bảng `sessions`: "phiên chết" ở đây là đúng
 * những gì đăng xuất / hết idle ghi xuống DB, không phải một cờ giả.
 */

const TEST_TIMEOUT = 120_000;
const IDLE_MINUTES = 30;

describe('Break-glass · quyền gắn với phiên đăng nhập (Q-15)', () => {
  let scratch: ScratchDb;
  let approvals: ApprovalsService;
  let sessions: SessionService;
  let breakGlass: BreakGlassService;
  let sweepJobs: Map<string, () => Promise<unknown>>;
  let userId: string;
  const auditLog: { actor: string; action: string; objectId: string }[] = [];
  const member = 'e2e-q15-member@qa.test';
  const other = 'e2e-q15-other@qa.test';

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
    const config = {
      getNumber: (key: string) => Promise.resolve(key === 'sessionIdleMinutes' ? IDLE_MINUTES : 24),
    } as unknown as SystemConfigService;
    sessions = new SessionService(scratch.db, config, {} as SweepService);
    sweepJobs = new Map();
    const sweep = {
      register: (job: { name: string; run: () => Promise<unknown> }) => {
        sweepJobs.set(job.name, job.run);
      },
    } as unknown as SweepService;
    const users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e, e]))),
      recipientsByRole: () => Promise.resolve([{ email: 'sa@qa.test', fullName: 'SA' }]),
    } as unknown as UsersApiService;
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      new ApprovalsApiService(approvals),
      { tierFor: () => Promise.resolve('needs_approval') } as unknown as AccessListService,
      config,
      new OutboxService(scratch.db, config, {} as SweepService),
      {} as VaultOwnersService,
      {} as VaultService,
      users,
      new AuthApiService(sessions, config),
      sweep,
    );
    breakGlass.onModuleInit();
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

  async function login(): Promise<string> {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, {
        userId,
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

  async function grantFor(sessionId: string, subject = randomUUID()) {
    const req = await breakGlass.request(
      { email: member, sessionId },
      { ownerType: 'device', ownerId: subject, reason: 'Sự cố lúc 2 giờ sáng', hours: 4 },
    );
    await breakGlass.approve('sa@qa.test', req.id, { hours: 4 });
    return { id: req.id, subject };
  }

  async function stateOf(id: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ state: string }>(
      `SELECT state FROM approval WHERE id = $1`,
      [id],
    );
    return rows[0].state;
  }

  async function runSweep() {
    const job = sweepJobs.get('break-glass-session-ended');
    if (!job) throw new Error('Chưa cắm lượt quét phiên kết thúc vào sweep');
    await job();
  }

  it('grant của phiên A: mở được từ A, KHÔNG mở được từ phiên B cùng người', async () => {
    const a = await login();
    const b = await login();
    const { id, subject } = await grantFor(a);

    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: a }, 'device', subject),
    ).resolves.toEqual({ tier: 'needs_approval', grantId: id });
    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: b }, 'device', subject),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });

    // Phiên B thấy đúng: không xem được, được xin lại, và được nói vì sao.
    const fromB = await breakGlass.verdictFor({ email: member, sessionId: b }, 'device', subject);
    expect(fromB.canReveal).toBe(false);
    expect(fromB.grant).toBeNull();
    expect(fromB.canRequest).toBe(true);
    expect(fromB.otherSessionHeld).toBe(true);

    const fromA = await breakGlass.verdictFor({ email: member, sessionId: a }, 'device', subject);
    expect(fromA.canReveal).toBe(true);
    expect(fromA.otherSessionHeld).toBe(false);
  });

  it('đăng xuất phiên A → grant hết ngay, kể cả khi còn giờ; lượt quét ghi hết hiệu lực', async () => {
    const a = await login();
    const { id, subject } = await grantFor(a);
    await logout(a);

    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: a }, 'device', subject),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });

    await runSweep();
    expect(await stateOf(id)).toBe('expired');
    const { rows } = await scratch.pool.query<{ detail: { note?: string } }>(
      `SELECT detail FROM approval_history WHERE approval_id = $1 AND to_state = 'expired'`,
      [id],
    );
    expect(rows[0].detail.note).toMatch(/phiên đăng nhập/i);
  });

  it('phiên A hết idle → grant hết; phiên còn sống thì lượt quét không đụng', async () => {
    const idle = await login();
    const alive = await login();
    const dead = await grantFor(idle);
    const live = await grantFor(alive);
    await scratch.pool.query(
      `UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [idle, IDLE_MINUTES + 1],
    );

    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: idle }, 'device', dead.subject),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });

    await runSweep();
    expect(await stateOf(dead.id)).toBe('expired');
    expect(await stateOf(live.id)).toBe('approved');
  });

  it('yêu cầu đang chờ mà phiên đã chết: được duyệt cũng không dùng được từ phiên mới', async () => {
    const a = await login();
    const subject = randomUUID();
    const req = await breakGlass.request(
      { email: member, sessionId: a },
      { ownerType: 'device', ownerId: subject, reason: 'Sự cố lúc 2 giờ sáng', hours: 4 },
    );
    await logout(a);
    const b = await login();

    // Phiên mới thấy "xin lại", không thấy phiếu treo của phiên đã chết.
    const before = await breakGlass.verdictFor({ email: member, sessionId: b }, 'device', subject);
    expect(before.pending).toBeNull();
    expect(before.canRequest).toBe(true);

    await breakGlass.approve('sa@qa.test', req.id, { hours: 4 });
    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: b }, 'device', subject),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });
  });

  it('xin lại từ phiên mới: phiếu treo của phiên cũ tự đóng, phiếu mới gắn phiên mới', async () => {
    const a = await login();
    const subject = randomUUID();
    const old = await breakGlass.request(
      { email: member, sessionId: a },
      { ownerType: 'device', ownerId: subject, reason: 'Sự cố lúc 2 giờ sáng', hours: 4 },
    );
    const b = await login();
    const fresh = await breakGlass.request(
      { email: member, sessionId: b },
      { ownerType: 'device', ownerId: subject, reason: 'Xin lại từ máy khác', hours: 2 },
    );
    expect(await stateOf(old.id)).toBe('cancelled');
    await breakGlass.approve('sa@qa.test', fresh.id, { hours: 2 });
    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: b }, 'device', subject),
    ).resolves.toMatchObject({ grantId: fresh.id });

    // Cùng phiên gửi hai lần thì vẫn là "đã có yêu cầu đang chờ".
    const c = await login();
    const s2 = randomUUID();
    await breakGlass.request(
      { email: member, sessionId: c },
      { ownerType: 'device', ownerId: s2, reason: 'Lần một', hours: 1 },
    );
    await expect(
      breakGlass.request(
        { email: member, sessionId: c },
        { ownerType: 'device', ownerId: s2, reason: 'Lần hai', hours: 1 },
      ),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_PENDING' } });
  });

  describe('lượt quét rút phiếu CHỜ của phiên đã chết', () => {
    async function pendingFrom(sessionId: string) {
      return breakGlass.request(
        { email: member, sessionId },
        { ownerType: 'device', ownerId: randomUUID(), reason: 'Chờ người duyệt', hours: 1 },
      );
    }

    it('phiên người xin đã chết → phiếu bị rút như người xin tự rút, có lịch sử + audit', async () => {
      const dead = await login();
      const p1 = await pendingFrom(dead);
      await logout(dead);
      await runSweep();

      expect(await stateOf(p1.id)).toBe('cancelled');
      const { rows } = await scratch.pool.query<{ actor: string; detail: { note?: string; by?: string } }>(
        `SELECT actor, detail FROM approval_history WHERE approval_id = $1 AND to_state = 'cancelled'`,
        [p1.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe('system');
      expect(rows[0].detail.note).toBe('Phiên đăng nhập của người xin đã kết thúc.');
      expect(rows[0].detail.by).toBe('session-ended');
      expect(auditLog).toContainEqual(
        expect.objectContaining({ actor: 'system', action: 'break_glass.cancelled', objectId: p1.id }),
      );
    });

    it('phiên hết idle cũng rút; phiên còn sống thì phiếu vẫn chờ', async () => {
      const idle = await login();
      const alive = await login();
      const stale = await pendingFrom(idle);
      const live = await pendingFrom(alive);
      await scratch.pool.query(
        `UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
        [idle, IDLE_MINUTES + 1],
      );
      await runSweep();
      expect(await stateOf(stale.id)).toBe('cancelled');
      expect(await stateOf(live.id)).toBe('pending');
    });

    it('badge người duyệt bớt đi đúng phiếu đã rút', async () => {
      const dead = await login();
      const alive = await login();
      await pendingFrom(alive);
      await pendingFrom(dead);
      const before = await breakGlass.pendingCountFor('sa@qa.test');
      await logout(dead);
      await runSweep();
      expect(await breakGlass.pendingCountFor('sa@qa.test')).toBe(before - 1);
    });

    it('người duyệt bấm Duyệt / Từ chối phiếu đã bị rút → 409 nói rõ phiếu đã được rút', async () => {
      const dead = await login();
      const p1 = await pendingFrom(dead);
      await logout(dead);
      await runSweep();

      await expect(breakGlass.approve('sa@qa.test', p1.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'BREAK_GLASS_WITHDRAWN',
          message: expect.stringMatching(/phiên đăng nhập của người xin đã kết thúc/i),
        },
      });
      await expect(breakGlass.deny('sa@qa.test', p1.id, 'Không cần nữa')).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_WITHDRAWN' },
      });
      expect(await stateOf(p1.id)).toBe('cancelled');
    });

    it('phiếu người xin TỰ rút: Duyệt cũng nhận 409 "đã được rút", không phải lỗi chung', async () => {
      const a = await login();
      const p1 = await pendingFrom(a);
      await breakGlass.cancel(member, p1.id);
      await expect(breakGlass.approve('sa@qa.test', p1.id, { hours: 1 })).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'BREAK_GLASS_WITHDRAWN',
          message: expect.stringMatching(/người xin đã rút/i),
        },
      });
    });

    it('phiếu đã duyệt của phiên chết vẫn đóng thành hết hiệu lực, không bị "rút"', async () => {
      const dead = await login();
      const { id } = await grantFor(dead);
      await logout(dead);
      await runSweep();
      expect(await stateOf(id)).toBe('expired');
    });
  });

  it('grant không mang phiên (cấp trước khi có luật này) không dùng được', async () => {
    const a = await login();
    const subject = randomUUID();
    const legacy = await scratch.db.transaction((tx) =>
      approvals.createWithin(tx, {
        kind: 'break_glass',
        requester: member,
        subjectType: 'device',
        subjectId: subject,
        reason: 'Phiếu cũ',
        payload: { hours: 4 },
      }),
    );
    await breakGlass.approve('sa@qa.test', legacy.id, { hours: 4 });
    await expect(
      breakGlass.assertCanReveal({ email: member, sessionId: a }, 'device', subject),
    ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });
  });

  describe('người xin tự trả quyền (VLT-055)', () => {
    it('trả grant của chính mình: hết ngay, không mở được nữa', async () => {
      const a = await login();
      const { id, subject } = await grantFor(a);
      const released = await breakGlass.release(member, id);
      expect(released.state).toBe('revoked');
      await expect(
        breakGlass.assertCanReveal({ email: member, sessionId: a }, 'device', subject),
      ).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_REQUIRED' } });
      const { rows } = await scratch.pool.query<{ actor: string }>(
        `SELECT actor FROM approval_history WHERE approval_id = $1 AND to_state = 'revoked'`,
        [id],
      );
      expect(rows.map((r) => r.actor)).toEqual([member]);
    });

    it('trả grant của NGƯỜI KHÁC bị chặn, grant vẫn nguyên', async () => {
      const a = await login();
      const { id, subject } = await grantFor(a);
      await expect(breakGlass.release(other, id)).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_REQUEST' },
      });
      expect(await stateOf(id)).toBe('approved');
      await expect(
        breakGlass.assertCanReveal({ email: member, sessionId: a }, 'device', subject),
      ).resolves.toMatchObject({ grantId: id });
    });

    it('phiếu chưa được duyệt thì không "trả" được (dùng Hủy yêu cầu)', async () => {
      const a = await login();
      const req = await breakGlass.request(
        { email: member, sessionId: a },
        { ownerType: 'device', ownerId: randomUUID(), reason: 'Chưa duyệt', hours: 1 },
      );
      await expect(breakGlass.release(member, req.id)).rejects.toMatchObject({
        response: { code: 'APPROVAL_TRANSITION_INVALID' },
      });
      expect(await stateOf(req.id)).toBe('pending');
    });
  });
});

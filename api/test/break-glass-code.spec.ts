import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { MailContentRegistry, type MailContent } from '../src/common/mail-content.registry';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { AuthApiService } from '../src/modules/auth/auth.api';
import { SessionService } from '../src/modules/auth/session.service';
import { BreakGlassService } from '../src/modules/vault/break-glass.service';
import { BREAK_GLASS_CODE_TOPIC, BreakGlassCodeService } from '../src/modules/vault/break-glass-code.service';
import type { AccessListService } from '../src/modules/vault/access-list.service';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import type { VaultOwnersService } from '../src/modules/vault/vault-owners.service';
import type { VaultService } from '../src/modules/vault/vault.service';
import type { UsersApiService } from '../src/modules/users/users.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-30 — "Xin mở két" duyệt bằng mã 6 số gửi qua mail.
 *
 * Mỗi bài dựng lại đúng một đòn: đoán mã, dùng mã của yêu cầu khác, người khác nhập mã hộ, dùng
 * mã quá 10 phút, dùng lại mã đã dùng, gửi lại quá 3 lần, và gửi thư cho người duyệt không được
 * chọn. Chạy trên Postgres thật: lượt sai phải được ghi xuống DB dù request trả lỗi.
 */

const TEST_TIMEOUT = 120_000;

/** Chùm master key giả, đổi được giữa bài: phiên bản hiện hành + những phiên bản còn trong chùm. */
const keyring = { current: 1, present: new Set([1]) };
const crypto = {
  get currentKeyVersion() {
    return keyring.current;
  },
  deriveKeyAt: (_info: string, version: number) => (keyring.present.has(version) ? Buffer.alloc(32, version) : null),
};
const noopSweep = { register: () => undefined } as unknown as SweepService;

describe('Break-glass · duyệt bằng mã (Q-30)', () => {
  let scratch: ScratchDb;
  let sessions: SessionService;
  let breakGlass: BreakGlassService;
  let contents: MailContentRegistry;
  let memberId: string;
  const member = 'e2e-q30-member@qa.test';
  const intruder = 'e2e-q30-other@qa.test';
  const sa = 'sa-q30@qa.test';
  const admin = 'admin-q30@qa.test';
  /** SA/Admin bị vô hiệu hoá / hạ vai giữa bài — biến mất khỏi `recipientsByRole` như thật. */
  const disabled = new Set<string>();

  beforeAll(async () => {
    scratch = await createScratchDb('ims_bg_code');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const kinds = new ApprovalKindRegistry();
    const approvals = new ApprovalsService(scratch.db, new AuditWriterService(scratch.db), kinds);
    const approvalsApi = new ApprovalsApiService(approvals);
    const config = {
      getNumber: (key: string) =>
        Promise.resolve(({ sessionIdleMinutes: 30, breakGlassPendingExpireHours: 8 } as Record<string, number>)[key] ?? 24),
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    } as unknown as SystemConfigService;
    sessions = new SessionService(scratch.db, config, noopSweep);
    const users = {
      namesByEmails: (emails: string[]) => Promise.resolve(new Map(emails.map((e) => [e.toLowerCase(), `Tên ${e}`]))),
      recipientsByRole: () =>
        Promise.resolve(
          [
            { email: sa, fullName: 'SA Q30' },
            { email: admin, fullName: 'Admin Q30' },
            { email: member, fullName: 'Chính người xin (là admin)' },
          ].filter((r) => !disabled.has(r.email)),
        ),
      roleByEmail: () => Promise.resolve('member'),
    } as unknown as UsersApiService;
    const outbox = new OutboxService(scratch.db, config, noopSweep);
    contents = new MailContentRegistry();
    const codes = new BreakGlassCodeService(
      scratch.db,
      crypto as unknown as EnvelopeCryptoService,
      new AuditWriterService(scratch.db),
      outbox,
      approvalsApi,
      kinds,
      users,
      contents,
      config,
    );
    codes.onModuleInit();
    breakGlass = new BreakGlassService(
      scratch.db,
      kinds,
      approvalsApi,
      { tierFor: () => Promise.resolve('needs_approval') } as unknown as AccessListService,
      config,
      outbox,
      { describe: () => Promise.resolve({ orphan: false, code: 'E2E-SW01', name: 'Switch', siteCode: 'HCM' }) } as unknown as VaultOwnersService,
      { countFor: () => Promise.resolve(0) } as unknown as VaultService,
      users,
      new AuthApiService(sessions, config),
      noopSweep,
      codes,
    );
    breakGlass.onModuleInit();
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ($1, 'Q30 Member', 'member', 'x', false), ($2, 'Q30 Other', 'member', 'x', false) RETURNING id`,
      [member, intruder],
    );
    memberId = rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function login(userId = memberId): Promise<string> {
    const created = await scratch.db.transaction((tx) =>
      sessions.createWithin(tx, { userId, ip: '10.0.0.1', userAgent: 'jest', absoluteHours: 12, totpPending: false }),
    );
    return created.id;
  }

  const as = (sessionId: string, email = member) => ({ email, sessionId });

  function ask(sessionId: string, approver = sa, subject = randomUUID()) {
    return breakGlass.request(as(sessionId), {
      ownerType: 'device',
      ownerId: subject,
      reason: 'Sự cố switch tầng 2',
      hours: 4,
      approver,
    });
  }

  /** Worker dựng thư lượt `sendNo` — đúng hàm consumer gọi. */
  async function mail(approvalId: string, sendNo = 1): Promise<MailContent | null> {
    return contents.find(BREAK_GLASS_CODE_TOPIC)!({ approvalId, sendNo });
  }

  async function codeOf(approvalId: string, sendNo = 1): Promise<string> {
    const built = await mail(approvalId, sendNo);
    const value = built?.rows.find((r) => r.label === 'Mã duyệt')?.value;
    if (!value) throw new Error('thư không mang mã');
    return value;
  }

  const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  async function approvalRow(id: string) {
    const { rows } = await scratch.pool.query<{
      state: string;
      decided_by: string | null;
      expires_at: Date | null;
      claimed_session_id: string | null;
    }>(`SELECT state, decided_by, expires_at, claimed_session_id FROM approval WHERE id = $1`, [id]);
    return rows[0];
  }

  async function codeRow(id: string) {
    const { rows } = await scratch.pool.query<{ code_hash: string | null; failed_attempts: number; send_no: number; approver: string }>(
      `SELECT code_hash, failed_attempts, send_no, approver FROM break_glass_code WHERE approval_id = $1`,
      [id],
    );
    return rows[0];
  }

  describe('chọn người duyệt', () => {
    it('danh sách chọn là SA/Admin đang hoạt động, không có chính người xin', async () => {
      const choices = await breakGlass.approverChoices(member);
      expect(choices.map((c) => c.email).sort()).toEqual([admin, sa].sort());
    });

    it.each([
      ['chính mình', member],
      ['người không phải SA/Admin', intruder],
      ['email không tồn tại', 'ai-do@ngoai.test'],
    ])('chọn %s → 400, không tạo yêu cầu', async (_label, approver) => {
      const s = await login();
      const subject = randomUUID();
      await expect(ask(s, approver, subject)).rejects.toMatchObject({
        status: 400,
        response: { code: 'BREAK_GLASS_APPROVER_INVALID' },
      });
      const { rows } = await scratch.pool.query(`SELECT 1 FROM approval WHERE subject_id = $1`, [subject]);
      expect(rows).toHaveLength(0);
    });

    it('chỉ người được chọn nhận thư; outbox chở id + lượt gửi, không chở mã', async () => {
      const s = await login();
      const req = await ask(s, admin);
      const { rows } = await scratch.pool.query<{ topic: string; payload: Record<string, unknown> }>(
        `SELECT topic, payload FROM outbox WHERE payload->>'approvalId' = $1`,
        [req.id],
      );
      expect(rows).toEqual([{ topic: BREAK_GLASS_CODE_TOPIC, payload: { approvalId: req.id, sendNo: 1 } }]);
      const built = await mail(req.id);
      expect(built?.to).toEqual([admin]);
      expect(built?.subject).not.toMatch(/\d{6}/);
      const code = built!.rows.find((r) => r.label === 'Mã duyệt')!.value;
      expect(code).toMatch(/^\d{6}$/);
      // DB chỉ giữ HMAC.
      const stored = await codeRow(req.id);
      expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.code_hash).not.toContain(code);
    });

    it('thư chung "cần duyệt" / thư nhắc của approvals không gửi cho mở két nữa', async () => {
      const s = await login();
      const req = await ask(s);
      await expect(contents.find('approval:break_glass')!({ approvalId: req.id })).resolves.toBeNull();
    });
  });

  describe('nhập mã', () => {
    it('đúng mã → được duyệt bởi người nhận mã, đủ số giờ xin, quyền gắn phiên đã nhập mã', async () => {
      const s = await login();
      const subject = randomUUID();
      const req = await ask(s, sa, subject);
      const code = await codeOf(req.id);
      const before = Date.now();
      await breakGlass.submitCode(as(s), req.id, code);
      const row = await approvalRow(req.id);
      expect(row.state).toBe('approved');
      expect(row.decided_by).toBe(sa);
      expect(row.claimed_session_id).toBe(s);
      expect(row.expires_at!.getTime() - before).toBeGreaterThan(4 * 3_600_000 - 60_000);
      expect(row.expires_at!.getTime() - before).toBeLessThanOrEqual(4 * 3_600_000 + 60_000);
      expect((await codeRow(req.id)).code_hash).toBeNull();
      // Phiên đó xem được ngay; phiên khác của chính người xin thì không.
      await expect(breakGlass.assertCanReveal(as(s), 'device', subject)).resolves.toEqual({ tier: 'needs_approval', grantId: req.id });
      const other = await login();
      await expect(breakGlass.assertCanReveal(as(other), 'device', subject)).rejects.toMatchObject({
        response: { code: 'BREAK_GLASS_OTHER_SESSION' },
      });
      const { rows } = await scratch.pool.query<{ actor: string; to_state: string | null; detail: Record<string, unknown> }>(
        `SELECT actor, to_state, detail FROM approval_history WHERE approval_id = $1 AND to_state = 'approved'`,
        [req.id],
      );
      expect(rows[0]).toMatchObject({ actor: sa, detail: { via: 'code', enteredBy: member } });
    });

    it('dùng lại mã đã dùng → bị từ chối (dùng một lần)', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      await breakGlass.submitCode(as(s), req.id, code);
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_NOT_PENDING' },
      });
    });

    it('người khác nhập mã của yêu cầu này → 404 như yêu cầu không tồn tại, mã vẫn còn', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      const other = await login((await scratch.pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [intruder])).rows[0].id);
      await expect(breakGlass.submitCode(as(other, intruder), req.id, code)).rejects.toMatchObject({
        status: 404,
        response: { code: 'APPROVAL_NOT_FOUND' },
      });
      expect((await approvalRow(req.id)).state).toBe('pending');
      await expect(breakGlass.submitCode(as(s), req.id, code)).resolves.toBeDefined();
    });

    it('mã của yêu cầu khác không mở được yêu cầu này', async () => {
      const s = await login();
      const first = await ask(s);
      const second = await ask(s);
      const codeOfFirst = await codeOf(first.id);
      await codeOf(second.id);
      await expect(breakGlass.submitCode(as(s), second.id, codeOfFirst)).rejects.toMatchObject({
        status: 400,
        response: { code: 'BREAK_GLASS_CODE_WRONG' },
      });
    });

    it('đoán mã: sai thì ghi lượt sai xuống DB; sai lần 5 thì yêu cầu bị huỷ, mã đúng cũng hết dùng', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      for (let i = 1; i <= 4; i++) {
        await expect(breakGlass.submitCode(as(s), req.id, wrongOf(code))).rejects.toMatchObject({
          status: 400,
          response: { code: 'BREAK_GLASS_CODE_WRONG' },
        });
        expect((await codeRow(req.id)).failed_attempts).toBe(i);
      }
      await expect(breakGlass.submitCode(as(s), req.id, wrongOf(code))).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_CODE_LOCKED' },
      });
      expect((await approvalRow(req.id)).state).toBe('cancelled');
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({ status: 409 });
      expect((await approvalRow(req.id)).state).toBe('cancelled');
    });

    it('gửi lại mã không mở thêm lượt đoán: lượt sai cộng dồn', async () => {
      const s = await login();
      const req = await ask(s);
      const first = await codeOf(req.id);
      for (let i = 0; i < 3; i++) {
        await expect(breakGlass.submitCode(as(s), req.id, wrongOf(first))).rejects.toMatchObject({ status: 400 });
      }
      await breakGlass.resendCode(as(s), req.id);
      const second = await codeOf(req.id, 2);
      await expect(breakGlass.submitCode(as(s), req.id, wrongOf(second))).rejects.toMatchObject({ status: 400 });
      await expect(breakGlass.submitCode(as(s), req.id, wrongOf(second))).rejects.toMatchObject({
        response: { code: 'BREAK_GLASS_CODE_LOCKED' },
      });
    });

    it('mã quá 10 phút → 409 hết hạn, không tính lượt sai, yêu cầu vẫn chờ để gửi lại mã', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      await scratch.pool.query(`UPDATE break_glass_code SET code_expires_at = now() - interval '1 second' WHERE approval_id = $1`, [req.id]);
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_CODE_EXPIRED' },
      });
      expect((await codeRow(req.id)).failed_attempts).toBe(0);
      expect((await approvalRow(req.id)).state).toBe('pending');
    });

    it('mã sống đúng 10 phút tính từ lúc dựng thư', async () => {
      const s = await login();
      const req = await ask(s);
      const before = Date.now();
      await codeOf(req.id);
      const { rows } = await scratch.pool.query<{ code_expires_at: Date }>(
        `SELECT code_expires_at FROM break_glass_code WHERE approval_id = $1`,
        [req.id],
      );
      const ttl = rows[0].code_expires_at.getTime() - before;
      expect(ttl).toBeGreaterThan(10 * 60_000 - 5_000);
      expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    });

    it('thư chưa đi (chưa có mã) → 409 chưa gửi, không tính lượt', async () => {
      const s = await login();
      const req = await ask(s);
      await expect(breakGlass.submitCode(as(s), req.id, '123456')).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_CODE_NOT_SENT' },
      });
      expect((await codeRow(req.id)).failed_attempts).toBe(0);
    });
  });

  describe('gửi lại mã', () => {
    it('tối đa 3 lần; lần thứ 4 → 409; mã cũ chết ngay khi gửi lại', async () => {
      const s = await login();
      const req = await ask(s);
      let code = await codeOf(req.id, 1);
      for (let n = 2; n <= 4; n++) {
        const status = await breakGlass.resendCode(as(s), req.id);
        expect(status.resendsLeft).toBe(4 - n);
        // Mã của lượt trước không còn dùng được, kể cả trước khi thư mới tới.
        await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({
          response: { code: 'BREAK_GLASS_CODE_NOT_SENT' },
        });
        // Thư của lượt cũ còn kẹt trong hàng đợi không được dựng lại mã.
        await expect(mail(req.id, n - 1)).resolves.toBeNull();
        code = await codeOf(req.id, n);
      }
      await expect(breakGlass.resendCode(as(s), req.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_CODE_RESEND_LIMIT' },
      });
      expect((await codeRow(req.id)).send_no).toBe(4);
      await expect(breakGlass.submitCode(as(s), req.id, code)).resolves.toBeDefined();
    });

    it('người khác không gửi lại mã được cho yêu cầu của mình', async () => {
      const s = await login();
      const req = await ask(s);
      await expect(breakGlass.resendCode(as(s, intruder), req.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('người duyệt', () => {
    it('badge chỉ đếm yêu cầu chọn đúng mình', async () => {
      const s = await login();
      const beforeSa = await breakGlass.pendingCountFor(sa);
      const beforeAdmin = await breakGlass.pendingCountFor(admin);
      await ask(s, admin);
      expect(await breakGlass.pendingCountFor(sa)).toBe(beforeSa);
      expect(await breakGlass.pendingCountFor(admin)).toBe(beforeAdmin + 1);
    });

    it('hàng chờ và trang chi tiết nói người duyệt đã chọn', async () => {
      const s = await login();
      const req = await ask(s, admin);
      const queue = await breakGlass.pendingForApprovers();
      expect(queue.find((r) => r.id === req.id)?.approver).toBe(admin);
      expect((await breakGlass.detail(sa, true, req.id)).approver).toBe(admin);
    });

    it('từ chối trong IMS vẫn được; mã của yêu cầu bị từ chối không dùng được', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      await breakGlass.deny(sa, req.id, 'Không cần');
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({ status: 409 });
    });

    it('verdict của người xin nói ai duyệt, còn mấy lần gửi lại, mã còn bao lâu', async () => {
      const s = await login();
      const subject = randomUUID();
      const req = await ask(s, admin, subject);
      await codeOf(req.id);
      const verdict = await breakGlass.verdictFor(as(s), 'device', subject);
      expect(verdict.pending?.id).toBe(req.id);
      expect(verdict.pendingCode).toMatchObject({ approver: admin, approverName: `Tên ${admin}`, resendsLeft: 3, attemptsLeft: 5 });
      expect(verdict.pendingCode!.codeSecondsLeft).toBeGreaterThan(590);
    });
  });

  describe('các đường mã ĐÚNG không được bị đếm là sai, người duyệt mất quyền thì mã chết', () => {
    afterEach(() => {
      disabled.clear();
      keyring.current = 1;
      keyring.present = new Set([1]);
    });

    it('người duyệt bị vô hiệu hoá / hạ vai sau lúc chọn: mã đã gửi không duyệt được, không gửi thêm mã', async () => {
      const s = await login();
      const subject = randomUUID();
      const req = await ask(s, admin, subject);
      const code = await codeOf(req.id);
      disabled.add(admin);
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_APPROVER_GONE' },
      });
      expect((await approvalRow(req.id)).state).toBe('pending');
      await expect(breakGlass.resendCode(as(s), req.id)).rejects.toMatchObject({ response: { code: 'BREAK_GLASS_APPROVER_GONE' } });
      await expect(mail(req.id, 1)).resolves.toBeNull();
      const verdict = await breakGlass.verdictFor(as(s), 'device', subject);
      expect(verdict.pendingCode?.approverActive).toBe(false);
    });

    it('worker dựng lại thư CÙNG lượt (lần trước lỗi sau khi SMTP đã nhận): mã của thư trước vẫn duyệt được', async () => {
      const s = await login();
      const req = await ask(s);
      const first = await codeOf(req.id, 1);
      const second = await codeOf(req.id, 1);
      expect(second).not.toBe(first);
      await breakGlass.submitCode(as(s), req.id, first);
      expect((await approvalRow(req.id)).state).toBe('approved');
      expect((await codeRow(req.id)).failed_attempts).toBe(0);
    });

    it('xoay master key giữa lúc mã còn sống: chìa cũ còn trong chùm thì mã đúng vẫn đúng', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      keyring.current = 2;
      keyring.present = new Set([1, 2]);
      await breakGlass.submitCode(as(s), req.id, code);
      expect((await approvalRow(req.id)).state).toBe('approved');
    });

    it('chìa đã băm mã bị gỡ khỏi chùm: mã coi như hết hạn, KHÔNG trừ lượt nhập', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      keyring.current = 2;
      keyring.present = new Set([2]);
      await expect(breakGlass.submitCode(as(s), req.id, code)).rejects.toMatchObject({
        response: { code: 'BREAK_GLASS_CODE_EXPIRED' },
      });
      expect((await codeRow(req.id)).failed_attempts).toBe(0);
    });

    it('người duyệt mở phiếu bị hủy vì sai mã 5 lần: được báo đúng lý do, không phải "người xin đã rút"', async () => {
      const s = await login();
      const req = await ask(s);
      const code = await codeOf(req.id);
      for (let i = 0; i < 5; i++) {
        await breakGlass.submitCode(as(s), req.id, wrongOf(code)).catch(() => undefined);
      }
      expect((await approvalRow(req.id)).state).toBe('cancelled');
      await expect(breakGlass.deny(sa, req.id, 'Không cần')).rejects.toMatchObject({
        status: 409,
        response: { code: 'BREAK_GLASS_WITHDRAWN', message: expect.stringMatching(/sai mã duyệt 5 lần/) },
      });
    });
  });
});

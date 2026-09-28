import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuditApiService } from '../src/modules/audit/audit.api';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService, type SessionRecord } from '../src/modules/auth/session.service';
import { TotpService } from '../src/modules/auth/totp.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Hồ sơ của tôi (Q-14): tự cài lại 2 lớp và tự đóng phiên — chạy `AuthService` thật trên DB thật.
 *
 * Hai hàng rào được dựng lại bằng đúng đòn tấn công:
 *   · cookie trộm được (không có điện thoại) KHÔNG thay được yếu tố thứ hai — thay được là chiếm
 *     tài khoản vĩnh viễn, vì chủ thật mất luôn đường vào;
 *   · một người dùng KHÔNG đóng được phiên của người khác bằng cách đoán/chép id phiên.
 */

const TEST_TIMEOUT = 120_000;
const PASSWORD = 'Mat-khau-dung-2026!';
const PEPPER = 'p'.repeat(64);
const MASTER_KEY = `1=${'a'.repeat(64)}`;
const noopSweep = { register: () => undefined } as unknown as SweepService;

async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (error) {
    const body = (error as { getResponse?: () => { code?: string } }).getResponse?.();
    if (!body?.code) throw error;
    return body.code;
  }
}

describe('Hồ sơ của tôi — cài lại 2 lớp và phiên của chính mình', () => {
  let scratch: ScratchDb;
  let auth: AuthService;
  let sessions: SessionService;
  let passwords: PasswordService;
  let totp: TotpService;
  let envelope: EnvelopeCryptoService;
  let users: UsersService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_self_service');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    passwords = new PasswordService(PEPPER);
    totp = new TotpService();
    envelope = new EnvelopeCryptoService(new MasterKeyRing(MASTER_KEY));
    users = new UsersService(db);
    sessions = new SessionService(db, config, noopSweep);
    auth = new AuthService(
      db,
      users,
      sessions,
      passwords,
      totp,
      envelope,
      audit,
      outbox,
      config,
      new KnownDeviceService(db),
      new LoginFailureService(db, config, noopSweep),
      new AuditApiService(new SecurityProbeService(db, config, outbox, audit)),
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let seq = 0;
  async function makeUser(): Promise<{ id: string; email: string; secret: string }> {
    seq += 1;
    const email = `self-${seq}@qa.test`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, totp_login_required, must_change_password)
       VALUES ($1, 'Nguoi tu phuc vu', 'member', $2, true, false) RETURNING id`,
      [email, await passwords.hash(PASSWORD)],
    );
    const id = rows[0].id;
    const secret = totp.generateSecret();
    const sealed = envelope.seal(secret, { table: 'users', recordId: id });
    await scratch.db.transaction((tx) => users.setTotpSecretWithin(tx, id, sealed));
    await scratch.pool.query('UPDATE users SET totp_enrolled_at = now() WHERE id = $1', [id]);
    return { id, email, secret };
  }

  /** Một phiên đã đăng nhập đủ; `steppedUp` = vừa gõ mã hiện tại (còn trong ân hạn). */
  async function openSession(userId: string, steppedUp: boolean): Promise<SessionRecord> {
    const created = await scratch.db.transaction(async (tx) => {
      const s = await sessions.createWithin(tx, {
        userId,
        ip: '198.51.100.9',
        userAgent: 'jest',
        absoluteHours: 12,
        totpPending: false,
      });
      if (steppedUp) await sessions.markSteppedUpWithin(tx, s.id);
      return s;
    });
    return (await sessions.find(created.id))!;
  }

  const codeFor = (secret: string) => totp.generateFor(secret, Math.floor(Date.now() / 1000));

  async function storedSecret(userId: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ ct: Buffer }>(
      'SELECT totp_secret_ct AS ct FROM users WHERE id = $1',
      [userId],
    );
    return rows[0].ct.toString('hex');
  }

  describe('cài lại 2 lớp khi đang có 2 lớp', () => {
    it(
      'TẤN CÔNG: phiên chưa step-up (cookie trộm, không có điện thoại) không lấy được secret mới',
      async () => {
        const u = await makeUser();
        const before = await storedSecret(u.id);
        const s = await openSession(u.id, false);
        // Có cả mật khẩu cũng không đủ: yếu tố thứ hai phải do CHÍNH yếu tố thứ hai cho phép thay.
        expect(await outcome(auth.startTotpReEnrollment(s, PASSWORD))).toBe('STEPUP_REQUIRED');
        expect(await storedSecret(u.id)).toBe(before);
      },
      TEST_TIMEOUT,
    );

    it(
      'đã step-up nhưng sai mật khẩu hiện tại → từ chối, secret giữ nguyên',
      async () => {
        const u = await makeUser();
        const before = await storedSecret(u.id);
        const s = await openSession(u.id, true);
        expect(await outcome(auth.startTotpReEnrollment(s, 'sai-mat-khau'))).toBe(
          'CURRENT_PASSWORD_WRONG',
        );
        expect(await storedSecret(u.id)).toBe(before);
      },
      TEST_TIMEOUT,
    );

    it(
      'bắt đầu KHÔNG đụng secret đang dùng — bỏ dở giữa chừng thì điện thoại cũ vẫn dùng được',
      async () => {
        const u = await makeUser();
        const before = await storedSecret(u.id);
        const s = await openSession(u.id, true);
        const started = await auth.startTotpReEnrollment(s, PASSWORD);
        expect(started.secret).not.toBe(u.secret);
        expect(started.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
        expect(started.otpauthUrl).toContain(`secret=${started.secret}`);
        expect(await storedSecret(u.id)).toBe(before);
      },
      TEST_TIMEOUT,
    );

    it(
      'xác nhận bằng mã của máy MỚI → thay secret, đóng các phiên khác, giữ phiên hiện tại',
      async () => {
        const u = await makeUser();
        const s = await openSession(u.id, true);
        const other = await openSession(u.id, false);
        const started = await auth.startTotpReEnrollment(s, PASSWORD);

        const result = await auth.confirmTotpReEnrollment(
          s,
          started.ticket,
          await codeFor(started.secret),
        );
        expect(result.revokedSessions).toBe(1);
        expect((await sessions.find(other.id))!.revokedAt).not.toBeNull();
        expect((await sessions.find(s.id))!.revokedAt).toBeNull();

        // Máy cũ hết dùng được, máy mới dùng được — kiểm qua cửa step-up thật.
        const fresh = await openSession(u.id, false);
        expect(await outcome(auth.stepUp(fresh, await codeFor(u.secret)))).toBe('TOTP_INVALID');
      },
      TEST_TIMEOUT,
    );

    it(
      'mã của máy CŨ không xác nhận được secret mới',
      async () => {
        const u = await makeUser();
        const s = await openSession(u.id, true);
        const started = await auth.startTotpReEnrollment(s, PASSWORD);
        const oldCode = await codeFor(u.secret);
        const newCode = await codeFor(started.secret);
        // Trùng mã giữa hai secret là một phần triệu — khi đó bài này không nói gì, bỏ qua lượt.
        if (oldCode === newCode) return;
        expect(await outcome(auth.confirmTotpReEnrollment(s, started.ticket, oldCode))).toBe(
          'TOTP_INVALID',
        );
      },
      TEST_TIMEOUT,
    );

    it(
      'TẤN CÔNG: vé cài lại của phiên này không dùng được ở phiên khác (kể cả cùng người)',
      async () => {
        const u = await makeUser();
        const s = await openSession(u.id, true);
        const started = await auth.startTotpReEnrollment(s, PASSWORD);
        const thief = await openSession(u.id, true);
        const before = await storedSecret(u.id);
        expect(
          await outcome(
            auth.confirmTotpReEnrollment(thief, started.ticket, await codeFor(started.secret)),
          ),
        ).toBe('REENROLL_TICKET_INVALID');
        expect(await storedSecret(u.id)).toBe(before);
      },
      TEST_TIMEOUT,
    );

    it(
      'vé bị sửa (một byte) → từ chối',
      async () => {
        const u = await makeUser();
        const s = await openSession(u.id, true);
        const started = await auth.startTotpReEnrollment(s, PASSWORD);
        const raw = Buffer.from(started.ticket, 'base64url');
        raw[raw.length - 1] ^= 0x01;
        expect(
          await outcome(
            auth.confirmTotpReEnrollment(
              s,
              raw.toString('base64url'),
              await codeFor(started.secret),
            ),
          ),
        ).toBe('REENROLL_TICKET_INVALID');
      },
      TEST_TIMEOUT,
    );
  });

  describe('phiên đăng nhập của tôi', () => {
    it(
      'danh sách chỉ có phiên CÒN SỐNG của chính mình, đánh dấu phiên hiện tại',
      async () => {
        const me = await makeUser();
        const stranger = await makeUser();
        const mine = await openSession(me.id, false);
        const second = await openSession(me.id, false);
        await openSession(stranger.id, false);
        const dead = await openSession(me.id, false);
        await scratch.db.transaction((tx) => sessions.revokeWithin(tx, dead.id, 'test'));

        const list = await auth.listOwnSessions(mine);
        expect(list.map((r) => r.id).sort()).toEqual([mine.id, second.id].sort());
        expect(list.find((r) => r.id === mine.id)!.current).toBe(true);
        expect(list.find((r) => r.id === second.id)!.current).toBe(false);
      },
      TEST_TIMEOUT,
    );

    it(
      'TẤN CÔNG: không đóng được phiên của NGƯỜI KHÁC dù biết id',
      async () => {
        const me = await makeUser();
        const victim = await makeUser();
        const mine = await openSession(me.id, false);
        const theirs = await openSession(victim.id, false);
        expect(await outcome(auth.revokeOwnSession(mine, theirs.id))).toBe('SESSION_NOT_FOUND');
        expect((await sessions.find(theirs.id))!.revokedAt).toBeNull();
      },
      TEST_TIMEOUT,
    );

    it(
      'đóng được một phiên khác của chính mình; phiên hiện tại thì phải dùng Đăng xuất',
      async () => {
        const me = await makeUser();
        const mine = await openSession(me.id, false);
        const other = await openSession(me.id, false);
        await auth.revokeOwnSession(mine, other.id);
        expect((await sessions.find(other.id))!.revokedAt).not.toBeNull();
        expect(await outcome(auth.revokeOwnSession(mine, mine.id))).toBe('SESSION_IS_CURRENT');
        const { rows } = await scratch.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE action = 'auth.session.revoked_self' AND object_id = $1`,
          [other.id],
        );
        expect(rows[0].n).toBe(1);
      },
      TEST_TIMEOUT,
    );

    it(
      '"Đăng xuất các máy khác" chỉ đóng phiên của chính mình, trừ phiên hiện tại',
      async () => {
        const me = await makeUser();
        const stranger = await makeUser();
        const mine = await openSession(me.id, false);
        const a = await openSession(me.id, false);
        const b = await openSession(me.id, false);
        const theirs = await openSession(stranger.id, false);

        expect(await auth.revokeOwnOtherSessions(mine)).toBe(2);
        expect((await sessions.find(a.id))!.revokedAt).not.toBeNull();
        expect((await sessions.find(b.id))!.revokedAt).not.toBeNull();
        expect((await sessions.find(mine.id))!.revokedAt).toBeNull();
        expect((await sessions.find(theirs.id))!.revokedAt).toBeNull();
      },
      TEST_TIMEOUT,
    );
  });

  it(
    'khoá auth.support_contact có sẵn trên DB trắng và là một chuỗi không rỗng',
    async () => {
      const config = new SystemConfigService(scratch.db);
      expect((await config.getString('authSupportContact')).trim().length).toBeGreaterThan(0);
      const { rows } = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM system_config WHERE key = 'auth.support_contact'`,
      );
      expect(rows[0].n).toBe(1);
    },
    TEST_TIMEOUT,
  );
});

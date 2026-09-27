import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AuditApiService } from '../src/modules/audit/audit.api';
import { SecurityProbeService } from '../src/modules/audit/security-probe.service';
import { AuthService, type LoginContext } from '../src/modules/auth/auth.service';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { TotpService } from '../src/modules/auth/totp.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, waitForLock, type ScratchDb } from './db';

/**
 * Trần đăng nhập theo TÀI KHOẢN (SEC-02, SEC-03, Q-06) — chạy `AuthService.login` thật.
 *
 * Vì sao ở tầng này: vế "đổi IP" cần nhiều IP thật, mà E2E không tự khai IP được (nginx nối
 * địa chỉ socket vào X-Forwarded-For, `trust proxy = 1`). Ở đây `ip` là tham số nên mỗi lượt
 * đến từ một nơi khác nhau thật sự. Mọi service là bản thật trên DB thật; chỉ `SweepService`
 * (sổ đăng ký job dọn) là đồ rỗng vì không liên quan.
 */

const TEST_TIMEOUT = 120_000;
const PASSWORD = 'Mat-khau-dung-2026!';
const PEPPER = 'p'.repeat(64);
const MASTER_KEY = `1=${'a'.repeat(64)}`;

const noopSweep = { register: () => undefined } as unknown as SweepService;
const from = (n: number): LoginContext => ({ ip: `198.51.100.${n}`, userAgent: 'jest' });

/** Mã lỗi nghiệp vụ của một lượt đăng nhập bị từ chối, hoặc 'ok' nếu lọt qua. */
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

describe('Trần đăng nhập theo tài khoản — AuthService trên DB thật', () => {
  let scratch: ScratchDb;
  let auth: AuthService;
  let passwords: PasswordService;
  let totp: TotpService;
  let envelope: EnvelopeCryptoService;
  let users: UsersService;
  let threshold: number;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_login_backoff');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const audit = new AuditWriterService(db);
    const outbox = new OutboxService(db, config, noopSweep);
    passwords = new PasswordService(PEPPER);
    totp = new TotpService();
    envelope = new EnvelopeCryptoService(new MasterKeyRing(MASTER_KEY));
    users = new UsersService(db);
    auth = new AuthService(
      db,
      users,
      new SessionService(db, config, noopSweep),
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
    threshold = await config.getNumber('loginMaxFailedAttempts');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  let seq = 0;
  /** Tài khoản đã qua lần đầu (không còn bắt đổi mật khẩu), có hoặc không có TOTP. */
  async function makeUser(withTotp: boolean): Promise<{ id: string; email: string; secret: string }> {
    seq += 1;
    const email = `backoff-${seq}@qa.test`;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, totp_login_required, must_change_password)
       VALUES ($1, 'Nguoi kiem tran', 'member', $2, $3, false) RETURNING id`,
      [email, await passwords.hash(PASSWORD), withTotp],
    );
    const id = rows[0].id;
    const secret = totp.generateSecret();
    if (withTotp) {
      const sealed = envelope.seal(secret, { table: 'users', recordId: id });
      await scratch.db.transaction((tx) => users.setTotpSecretWithin(tx, id, sealed));
      await scratch.pool.query('UPDATE users SET totp_enrolled_at = now() WHERE id = $1', [id]);
    }
    return { id, email, secret };
  }

  it(
    'SEC-03: sai đủ ngưỡng, mỗi lượt từ MỘT IP KHÁC → mật khẩu ĐÚNG từ IP mới vẫn bị chặn',
    async () => {
      const u = await makeUser(false);
      for (let i = 1; i <= threshold; i += 1) {
        // Mỗi IP chỉ sai một lần — trần theo cặp (người dùng, IP) không bao giờ chạm tới.
        expect(await outcome(auth.login(u.email, 'sai-roi', from(i)))).toBe('LOGIN_FAILED');
      }
      expect(await outcome(auth.login(u.email, PASSWORD, from(200)))).toBe('ACCOUNT_LOCKED');
    },
    TEST_TIMEOUT,
  );

  it(
    'VẾ ĐỐI CHỨNG: dưới ngưỡng thì mật khẩu đúng từ IP mới vẫn vào được',
    async () => {
      const u = await makeUser(false);
      for (let i = 1; i < threshold; i += 1) {
        await outcome(auth.login(u.email, 'sai-roi', from(i)));
      }
      expect(await outcome(auth.login(u.email, PASSWORD, from(200)))).toBe('ok');
    },
    TEST_TIMEOUT,
  );

  it(
    'SEC-02: mật khẩu đúng KHÔNG xoá bộ đếm khi còn cửa TOTP — đoán mã xen kẽ đăng nhập vẫn lên bậc chờ',
    async () => {
      const u = await makeUser(true);
      for (let i = 1; i <= threshold; i += 1) {
        const r = await auth.login(u.email, PASSWORD, from(i));
        expect(r.status).toBe('totp-required');
        // '000000' có thể trùng mã thật một lần trong một triệu; đổi sang mã chắc chắn sai.
        const real = await totp.generateFor(u.secret, Math.floor(Date.now() / 1000));
        const wrong = real === '000000' ? '111111' : '000000';
        expect(await outcome(auth.verifyLoginTotp(r.session as never, wrong, from(i)))).toBe(
          'TOTP_INVALID',
        );
      }
      expect(await outcome(auth.login(u.email, PASSWORD, from(200)))).toBe('ACCOUNT_LOCKED');
    },
    TEST_TIMEOUT,
  );

  it(
    'L8: lượt đoán ĐÚNG đang chạy song song với lượt vừa đẩy tài khoản lên bậc chờ thì không được cấp phiên',
    async () => {
      const u = await makeUser(false);
      /*
       * Dựng đúng khe: một lượt sai khác đang giữ khoá hàng `users` và sắp commit bậc chờ. Lượt
       * đúng đọc trạng thái CŨ (chưa khoá) ở cửa đầu, qua Argon2, rồi phải đợi hàng đó. Kiểm
       * lại sau khi có khoá hàng thì thấy bậc chờ; kiểm một lần ở đầu thì lọt.
       */
      const holder = await scratch.pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [u.id]);
        const attempt = outcome(auth.login(u.email, PASSWORD, from(1)));
        const settledEarly = await Promise.race([
          attempt.then(() => true),
          waitForLock(scratch.pool, 15_000).then(() => false),
        ]);
        await holder.query(
          `UPDATE users SET failed_attempts = $2, locked_until = now() + interval '5 minutes'
            WHERE id = $1`,
          [u.id, threshold],
        );
        await holder.query('COMMIT');
        // Lượt đúng phải đợi hàng đang bị giữ, không được chạy thẳng qua.
        expect(settledEarly).toBe(false);
        expect(await attempt).toBe('ACCOUNT_LOCKED');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
      const { rows } = await scratch.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM sessions WHERE user_id = $1',
        [u.id],
      );
      expect(rows[0].n).toBe(0);
    },
    TEST_TIMEOUT,
  );
});

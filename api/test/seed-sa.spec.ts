import { Pool } from 'pg';
import { runMigrations } from '../src/database/migration-runner';
import { PasswordService } from '../src/modules/auth/password.service';
import { seedSuperAdmins, SeedRefusedError } from '../src/ops/seed-sa';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * SEC-04 — tài khoản đầu tiên trên production.
 *
 * Bản cũ tạo 5 tài khoản cùng một mật khẩu nằm trong git. Người trong LAN đăng nhập trước sẽ
 * tự cài TOTP của mình (trong cửa sổ miễn nhập lại mật khẩu) và chiếm luôn tài khoản SA.
 * Bản mới: chỉ tạo SA, mật khẩu ngẫu nhiên riêng từng người, và chỉ chạy được trên DB chưa có SA.
 */

const TEST_TIMEOUT = 120_000;
const PEPPER = 'p'.repeat(40);

describe('SEC-04 · seed SA đầu tiên', () => {
  let scratch: ScratchDb;
  let pool: Pool;
  const passwords = new PasswordService(PEPPER);
  const admins = [
    { email: 'sa@pmh.com.vn', fullName: 'Super Admin' },
    { email: 'caothuan@pmh.com.vn', fullName: 'Cao Thuấn' },
  ];

  beforeAll(async () => {
    scratch = await createScratchDb('ims_seed_sa');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    pool = scratch.pool;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'DB trắng: tạo đúng các SA, mật khẩu ngẫu nhiên riêng từng người, bắt đổi mật khẩu + cài 2 lớp',
    async () => {
      const created = await seedSuperAdmins(pool, passwords, admins);
      expect(created.map((c) => c.email)).toEqual(admins.map((a) => a.email));

      const [a, b] = created.map((c) => c.password);
      expect(a).not.toBe(b);
      for (const pw of [a, b]) {
        expect(pw.length).toBeGreaterThanOrEqual(16);
        expect(pw).not.toContain('Pmh@1212');
      }

      const { rows } = await pool.query<{
        email: string;
        role: string;
        password_hash: string;
        must_change_password: boolean;
        totp_login_required: boolean;
      }>(
        `SELECT email, role, password_hash, must_change_password, totp_login_required
           FROM users ORDER BY email`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.role).toBe('sa');
        expect(row.must_change_password).toBe(true);
        expect(row.totp_login_required).toBe(true);
        const plain = created.find((c) => c.email === row.email)!.password;
        await expect(passwords.verify(row.password_hash, plain)).resolves.toBe(true);
      }
    },
    TEST_TIMEOUT,
  );

  it('mỗi tài khoản tạo ra có một dòng audit', async () => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'account.seeded'`,
    );
    expect(rows[0].n).toBe(2);
  });

  it('đã có SA thì từ chối, không tạo thêm gì', async () => {
    await expect(
      seedSuperAdmins(pool, passwords, [{ email: 'ke-la@pmh.com.vn', fullName: 'Kẻ lạ' }]),
    ).rejects.toBeInstanceOf(SeedRefusedError);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    expect(rows[0].n).toBe(2);
  });

  it('danh sách rỗng hoặc email trùng thì từ chối trước khi chạm DB', async () => {
    await expect(seedSuperAdmins(pool, passwords, [])).rejects.toBeInstanceOf(SeedRefusedError);
    await expect(
      seedSuperAdmins(pool, passwords, [admins[0], { ...admins[0], fullName: 'Trùng' }]),
    ).rejects.toBeInstanceOf(SeedRefusedError);
  });
});

import type { Pool } from 'pg';
import { generateTemporaryPassword } from '../common/temporary-password';
import type { PasswordService } from '../modules/auth/password.service';

/**
 * Tạo các SA đầu tiên trên một DB chưa có SA (SEC-04, `docs/QUYET-DINH.md` Q-06).
 *
 * - Chỉ tạo SA. Admin/member tạo qua giao diện, để mỗi người có mật khẩu tạm riêng qua đúng
 *   luồng tạo tài khoản.
 * - Mật khẩu tạm sinh ngẫu nhiên cho từng người, trả về đúng một lần để in ra màn hình.
 * - Từ chối khi đã có SA: script này là cửa dựng hệ thống, không phải cửa thêm quyền.
 * - Một transaction cho mọi tài khoản + dòng audit (AD-5): hoặc đủ cả, hoặc không có gì.
 */

export interface SeedAdmin {
  email: string;
  fullName: string;
}

export interface SeededAdmin {
  email: string;
  password: string;
}

export class SeedRefusedError extends Error {}

const DEFAULT_ADMINS: SeedAdmin[] = [
  { email: 'sa@pmh.com.vn', fullName: 'Super Admin' },
  { email: 'caothuan@pmh.com.vn', fullName: 'Cao Thuấn' },
];

export async function seedSuperAdmins(
  pool: Pool,
  passwords: PasswordService,
  admins: SeedAdmin[],
): Promise<SeededAdmin[]> {
  if (admins.length === 0) throw new SeedRefusedError('Chưa có email SA nào để tạo.');
  const emails = admins.map((a) => a.email.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) {
    throw new SeedRefusedError('Danh sách có email trùng nhau.');
  }

  const prepared = await Promise.all(
    admins.map(async (a, i) => {
      const password = generateTemporaryPassword();
      return { ...a, email: emails[i], password, hash: await passwords.hash(password) };
    }),
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Khoá bảng để hai lượt chạy song song không cùng thấy "chưa có SA".
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const existing = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE role = 'sa'`,
    );
    if (existing.rows[0].n > 0) {
      throw new SeedRefusedError(
        'Hệ thống đã có SA. Tạo thêm tài khoản bằng màn Người dùng IMS, không dùng script này.',
      );
    }
    for (const a of prepared) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash, must_change_password, totp_login_required)
         VALUES ($1, $2, 'sa', $3, true, true) RETURNING id`,
        [a.email, a.fullName, a.hash],
      );
      await client.query(
        `INSERT INTO audit_log (actor, action, object_type, object_id, detail)
         VALUES ('system:seed-sa', 'account.seeded', 'user', $1, $2)`,
        [rows[0].id, JSON.stringify({ email: a.email, role: 'sa' })],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return prepared.map((a) => ({ email: a.email, password: a.password }));
}

/** `email` hoặc `email=Họ tên` → SeedAdmin. Không có tham số thì dùng DEFAULT_ADMINS. */
export function parseAdminArgs(args: string[]): SeedAdmin[] {
  if (args.length === 0) return DEFAULT_ADMINS;
  return args.map((arg) => {
    const [email, ...name] = arg.split('=');
    return { email, fullName: name.join('=').trim() || email.split('@')[0] };
  });
}

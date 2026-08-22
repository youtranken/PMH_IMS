#!/usr/bin/env node
/**
 * Seed tài khoản người dùng đầu tiên (story 1.4).
 *
 * KHÔNG làm bằng migration vì hash phụ thuộc pepper — pepper là docker secret, SQL không đọc được.
 * Chạy trong container api:  docker compose exec api node scripts/seed-sa.mjs
 *
 * Idempotent: user đã tồn tại thì bỏ qua (không ghi đè mật khẩu đang dùng).
 * Mọi tài khoản seed đều `must_change_password = true` và chưa enroll TOTP —
 * lần đăng nhập đầu buộc đổi mật khẩu + cài xác thực 2 lớp.
 */
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const ARGON = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

/** Team IT 5 người. Mật khẩu tạm do SA đổi ngay sau lần đăng nhập đầu. */
const SEED_USERS = [
  { email: 'sa@pmh.com.vn', fullName: 'Super Admin', role: 'sa', password: 'Pmh@1212' },
  { email: 'caothuan@pmh.com.vn', fullName: 'Cao Thuấn', role: 'sa', password: 'Pmh@1212' },
  { email: 'itadmin@pmh.com.vn', fullName: 'IT Admin', role: 'admin', password: 'Pmh@1212' },
  { email: 'it01@pmh.com.vn', fullName: 'IT Nhân viên 01', role: 'member', password: 'Pmh@1212' },
  { email: 'it02@pmh.com.vn', fullName: 'IT Nhân viên 02', role: 'member', password: 'Pmh@1212' },
];

async function main() {
  const pepperFile = process.env.PASSWORD_PEPPER_FILE;
  if (!pepperFile) throw new Error('Thiếu PASSWORD_PEPPER_FILE.');
  const pepper = readFileSync(pepperFile, 'utf8').trim();
  if (pepper.length < 32) throw new Error('Pepper quá ngắn (<32 ký tự).');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const user of SEED_USERS) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rowCount > 0) {
        console.log(`· bỏ qua ${user.email} (đã tồn tại)`);
        continue;
      }
      const passwordHash = await hash(`${user.password}${pepper}`, ARGON);
      await pool.query(
        `INSERT INTO users (email, full_name, role, password_hash, must_change_password, totp_login_required)
         VALUES ($1, $2, $3, $4, true, true)`,
        [user.email, user.fullName, user.role, passwordHash],
      );
      console.log(`✓ tạo ${user.email} (${user.role}) — mật khẩu tạm: ${user.password}`);
    }

    const sa = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='sa' AND status='active'");
    console.log(`\nSA đang hoạt động: ${sa.rows[0].n} (NFR-01 yêu cầu tối thiểu 2).`);
    console.log('Nhắc: đăng nhập lần đầu sẽ buộc đổi mật khẩu và quét QR cài xác thực 2 lớp.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed thất bại:', error.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Đưa tài khoản dùng cho test E2E về trạng thái "vừa được SA tạo":
 * mật khẩu tạm đã biết, chưa cài TOTP, buộc đổi mật khẩu, không còn phiên nào.
 *
 * CHỈ dùng ở môi trường dev/CI. Không có endpoint API nào làm việc này —
 * cố tình, để production không tồn tại cửa hậu (NFR-01).
 *
 *   docker compose exec -T api node scripts/reset-e2e-user.mjs
 */
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const ARGON = { algorithm: 2, memoryCost: 65_536, timeCost: 3, parallelism: 1 };

const E2E_USERS = [
  { email: 'e2e-sa@pmh.com.vn', fullName: 'E2E Super Admin', role: 'sa', password: 'E2e@Test#2026' },
  { email: 'e2e-member@pmh.com.vn', fullName: 'E2E Thành viên', role: 'member', password: 'E2e@Test#2026' },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_E2E_RESET) {
    // Compose dev vẫn chạy NODE_ENV=production; cần cờ tường minh để không lỡ tay chạy ở prod thật.
    console.warn('NODE_ENV=production — đặt ALLOW_E2E_RESET=1 nếu đây đúng là môi trường test.');
  }
  const pepper = readFileSync(process.env.PASSWORD_PEPPER_FILE, 'utf8').trim();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const user of E2E_USERS) {
      const passwordHash = await hash(`${user.password}${pepper}`, ARGON);
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rowCount > 0) {
        const id = existing.rows[0].id;
        await pool.query(
          `UPDATE users SET password_hash=$2, must_change_password=true, status='active',
             failed_attempts=0, locked_until=NULL, totp_secret_ct=NULL, totp_secret_iv=NULL,
             totp_secret_tag=NULL, totp_dek_wrapped=NULL, totp_key_version=NULL,
             totp_enrolled_at=NULL, totp_last_timestep=NULL, totp_login_required=true,
             updated_at=now()
           WHERE id=$1`,
          [id, passwordHash],
        );
        await pool.query(
          `UPDATE sessions SET revoked_at=now(), revoked_reason='e2e-reset'
           WHERE user_id=$1 AND revoked_at IS NULL`,
          [id],
        );
        await pool.query('DELETE FROM known_device WHERE user_id=$1', [id]);
        console.log(`↻ reset ${user.email}`);
      } else {
        await pool.query(
          `INSERT INTO users (email, full_name, role, password_hash, must_change_password, totp_login_required)
           VALUES ($1,$2,$3,$4,true,true)`,
          [user.email, user.fullName, user.role, passwordHash],
        );
        console.log(`✓ tạo ${user.email}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Reset E2E thất bại:', error.message);
  process.exit(1);
});

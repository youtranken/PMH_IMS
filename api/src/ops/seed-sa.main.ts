import { Pool } from 'pg';
import { PasswordService } from '../modules/auth/password.service';
import { parseAdminArgs, seedSuperAdmins, SeedRefusedError } from './seed-sa';

/**
 * Chạy MỘT lần khi dựng hệ thống, trong container api:
 *
 *   docker compose exec api node dist/ops/seed-sa.main.js
 *   docker compose exec api node dist/ops/seed-sa.main.js a@pmh.com.vn="Họ Tên" b@pmh.com.vn
 *
 * Mật khẩu tạm chỉ hiện ở đây, một lần. Chép ra giấy, trao tận tay; không gửi qua chat/email.
 */
async function main(): Promise<void> {
  const passwords = PasswordService.fromSecretFile();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const created = await seedSuperAdmins(pool, passwords, parseAdminArgs(process.argv.slice(2)));
    console.log('Đã tạo SA. Mật khẩu tạm (chỉ hiện MỘT lần):\n');
    for (const c of created) console.log(`  ${c.email}   ${c.password}`);
    console.log('\nĐăng nhập lần đầu sẽ buộc đổi mật khẩu và cài xác thực 2 lớp.');
    if (created.length < 2) console.log('Lưu ý: nên có ít nhất 2 SA (duyệt bốn mắt, không khóa SA cuối).');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error instanceof SeedRefusedError ? `Từ chối: ${message}` : `Seed thất bại: ${message}`);
  process.exit(1);
});

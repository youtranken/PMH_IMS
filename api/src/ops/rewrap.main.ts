import { Pool } from 'pg';
import { EnvelopeCryptoService } from '../common/crypto/envelope.service';
import { MasterKeyRing } from '../common/crypto/master-key-ring';
import { redactMessage } from '../common/log-redact';
import { countByKeyVersion, rewrapAll } from './rewrap';

/**
 * Xoay master key khi nghi lộ (xem secrets/README.md và docs/RUNBOOK-4.3-dong-dot-1.md mục H):
 *
 *   docker compose exec api node dist/ops/rewrap.main.js --check   # chỉ đếm, không đổi gì
 *   docker compose exec api node dist/ops/rewrap.main.js           # bọc lại sang chìa hiện hành
 *
 * Chạy lại được bất cứ lúc nào; bị ngắt giữa chừng thì chạy lại là đi tiếp.
 */
async function main(): Promise<void> {
  const keyring = MasterKeyRing.fromSecretFile();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (!process.argv.includes('--check')) {
      const done = await rewrapAll(pool, new EnvelopeCryptoService(keyring));
      console.log(`Đã bọc lại sang chìa ${keyring.currentVersion}: ${done.secret} ngăn két, ${done.totp} khóa TOTP.`);
    }
    console.log(`Chìa trong file: ${keyring.versions.join(', ')} (hiện hành: ${keyring.currentVersion})`);
    const counts = await countByKeyVersion(pool);
    for (const c of counts) console.log(`  ${c.store.padEnd(10)} version ${c.keyVersion}: ${c.count} bản ghi`);
    const old = counts.filter((c) => c.keyVersion !== keyring.currentVersion);
    console.log(
      old.length === 0
        ? 'Không còn bản ghi nào ở chìa cũ — có thể bỏ các dòng chìa cũ khỏi secrets/master_key.'
        : 'CÒN bản ghi ở chìa cũ — KHÔNG được bỏ dòng chìa cũ.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Rewrap thất bại: ${redactMessage(error)}`);
  process.exit(1);
});

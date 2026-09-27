#!/usr/bin/env node
/**
 * Diễn tập khôi phục (story 4.3, NFR-02): chứng minh chìa in trên giấy mở được ciphertext
 * trong bản sao lưu. In ra MỘT plaintext của MỘT secret thử.
 *
 * CỐ Ý KHÔNG nằm trong image production (api/Dockerfile không COPY thư mục scripts/).
 * Muốn dùng thì mount vào lúc diễn tập, giống `reset-e2e-user.mjs`:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.override.drill.yml up -d api
 *   docker compose exec -T api node scripts/drill-open-secret.mjs <secret-id>
 *
 * Dùng LẠI `EnvelopeCryptoService` đã build trong `dist/`, không tự viết lại phần giải mã
 * (AD-15). Viết lại thì bản sao ở đây và bản thật sẽ trôi khỏi nhau — và cái trôi đó chỉ lộ
 * ra đúng hôm cần khôi phục thật, tức là hôm không còn đường lui nào khác.
 *
 * Ba hàng rào để đây không thành cửa hậu xuất két (FR-026):
 *   1. Phải khai ALLOW_RESTORE_DRILL=1 — máy thật không đặt biến này.
 *   2. Chỉ mở secret có nhãn chứa "drill". Két thật không mở được bằng script này.
 *   3. Nhận đúng MỘT id, không nhận danh sách, không có vòng lặp.
 */
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (process.env.ALLOW_RESTORE_DRILL !== '1') {
    fail(
      'Từ chối chạy: script chỉ dành cho diễn tập khôi phục trên máy sạch. ' +
        'Nếu đúng là buổi diễn tập, chạy lại với ALLOW_RESTORE_DRILL=1.',
    );
  }
  const id = process.argv[2];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail('Cần đúng một secret id (uuid).');

  const { EnvelopeCryptoService } = require('../dist/common/crypto/envelope.service.js');
  const { MasterKeyRing } = require('../dist/common/crypto/master-key-ring.js');
  const crypto = new EnvelopeCryptoService(MasterKeyRing.fromSecretFile());

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT id, label, key_version, value_ct, value_iv, value_tag, dek_wrapped
         FROM secret WHERE id = $1 AND label ILIKE '%drill%'`,
      [id],
    );
    if (rows.length === 0) {
      fail(
        'Không thấy secret THỬ nào có id đó. Script này chỉ mở secret có nhãn chứa "drill" — ' +
          'két thật không mở được bằng đường này (FR-026).',
      );
    }
    const row = rows[0];
    const value = crypto.openText(
      {
        ciphertext: row.value_ct,
        iv: row.value_iv,
        tag: row.value_tag,
        wrappedDek: row.dek_wrapped,
        keyVersion: row.key_version,
      },
      { table: 'secret', recordId: row.id },
    );
    console.log(`nhãn      : ${row.label}`);
    console.log(`chìa dùng : version ${row.key_version}`);
    console.log(`giá trị   : ${value}`);
    console.log('\nSo chuỗi trên với chuỗi ghi trong biên bản lần cất.');
  } finally {
    await pool.end();
  }
}

main().catch((error) =>
  fail(
    `Giải mã KHÔNG thành công: ${error.message}\n` +
      'Hay gặp nhất: bản sao lưu cũ hơn lần xoay chìa (thiếu version cũ trong phong bì), ' +
      'hoặc gõ nhầm một ký tự hex.',
  ),
);

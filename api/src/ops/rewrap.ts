import type { Pool, PoolClient } from 'pg';
import type { EnvelopeCryptoService } from '../common/crypto/envelope.service';
import type { MasterKeyRing } from '../common/crypto/master-key-ring';
import type { SealedValue } from '../common/crypto/envelope.types';

/**
 * Xoay master key cho DỮ LIỆU CŨ (DOM-01, `docs/QUYET-DINH.md` Q-07).
 *
 * Hai nơi giữ dữ liệu niêm bằng master key — thêm nơi thứ ba thì phải thêm vào `STORES`:
 *   · két sắt: bảng `secret`, AAD table `secret`;
 *   · khoá TOTP: các cột `totp_*` trên `users`, AAD table `users`.
 *
 * `rewrapAll` bọc lại từng bản ghi chưa ở chìa hiện hành, theo lô, mỗi lô một transaction với
 * `FOR UPDATE SKIP LOCKED`: bị ngắt giữa chừng thì chạy lại là đi tiếp, không làm lại phần đã xong.
 */

interface Store {
  name: 'secret' | 'users.totp';
  aadTable: string;
  select: string;
  update: string;
}

const STORES: Store[] = [
  {
    name: 'secret',
    aadTable: 'secret',
    select: `SELECT id, value_ct AS ct, value_iv AS iv, value_tag AS tag, dek_wrapped AS dek, key_version AS v
               FROM secret WHERE key_version <> $1 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
    update: `UPDATE secret SET value_ct = $2, value_iv = $3, value_tag = $4, dek_wrapped = $5, key_version = $6
              WHERE id = $1`,
  },
  {
    name: 'users.totp',
    aadTable: 'users',
    select: `SELECT id, totp_secret_ct AS ct, totp_secret_iv AS iv, totp_secret_tag AS tag,
                    totp_dek_wrapped AS dek, totp_key_version AS v
               FROM users WHERE totp_key_version IS NOT NULL AND totp_key_version <> $1
              ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
    update: `UPDATE users SET totp_secret_ct = $2, totp_secret_iv = $3, totp_secret_tag = $4,
                              totp_dek_wrapped = $5, totp_key_version = $6
              WHERE id = $1`,
  },
];

export interface KeyVersionCount {
  store: Store['name'];
  keyVersion: number;
  count: number;
}

/** Bao nhiêu bản ghi đang ở mỗi version chìa. Chìa cũ chỉ được huỷ khi nó không còn ở đây. */
export async function countByKeyVersion(pool: Pool): Promise<KeyVersionCount[]> {
  const { rows } = await pool.query<{ store: Store['name']; v: number; n: number }>(
    `SELECT 'secret' AS store, key_version AS v, count(*)::int AS n FROM secret GROUP BY key_version
     UNION ALL
     SELECT 'users.totp', totp_key_version, count(*)::int FROM users
      WHERE totp_key_version IS NOT NULL GROUP BY totp_key_version
     ORDER BY 1, 2`,
  );
  return rows.map((r) => ({ store: r.store, keyVersion: r.v, count: r.n }));
}

/**
 * Cổng khởi động: keyring phải có đủ mọi version mà dữ liệu còn dùng. Thiếu một version là
 * mọi bản ghi ở version đó — kể cả trong bản sao lưu — không mở được nữa, và mọi người dùng có
 * TOTP ở version đó bị chặn ở bước đăng nhập. Thà không khởi động còn hơn chạy trong tình trạng ấy.
 */
export async function assertKeyringCovers(pool: Pool, keyring: MasterKeyRing): Promise<void> {
  const have = new Set(keyring.versions);
  const missing = (await countByKeyVersion(pool)).filter((c) => !have.has(c.keyVersion));
  if (missing.length === 0) return;
  const detail = missing.map((m) => `${m.store}: ${m.count} bản ghi ở version ${m.keyVersion}`);
  throw new Error(
    `File master key thiếu chìa mà dữ liệu còn cần — ${detail.join('; ')}. ` +
      'Trả lại dòng chìa cũ vào secrets/master_key (lấy từ phong bì). Chỉ bỏ chìa cũ sau khi ' +
      '`node dist/ops/rewrap.main.js --check` báo không còn bản ghi nào ở version đó.',
  );
}

export async function rewrapAll(
  pool: Pool,
  envelope: EnvelopeCryptoService,
  options: { batchSize?: number } = {},
): Promise<{ secret: number; totp: number }> {
  const batchSize = options.batchSize ?? 100;
  const current = envelope.currentKeyVersion;
  const done = { secret: 0, totp: 0 };
  for (const store of STORES) {
    for (;;) {
      const n = await rewrapBatch(pool, envelope, store, current, batchSize);
      if (store.name === 'secret') done.secret += n;
      else done.totp += n;
      if (n < batchSize) break;
    }
  }
  await pool.query(
    `INSERT INTO audit_log (actor, action, object_type, detail)
     VALUES ('system:rewrap', 'crypto.rewrapped', 'master_key', $1)`,
    [JSON.stringify({ toVersion: current, ...done })],
  );
  return done;
}

async function rewrapBatch(
  pool: Pool,
  envelope: EnvelopeCryptoService,
  store: Store,
  current: number,
  batchSize: number,
): Promise<number> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      ct: Buffer;
      iv: Buffer;
      tag: Buffer;
      dek: Buffer;
      v: number;
    }>(store.select, [current, batchSize]);
    for (const r of rows) {
      const sealed: SealedValue = {
        ciphertext: r.ct,
        iv: r.iv,
        tag: r.tag,
        wrappedDek: r.dek,
        keyVersion: r.v,
      };
      const next = envelope.rewrap(sealed, { table: store.aadTable, recordId: r.id });
      await client.query(store.update, [
        r.id,
        next.ciphertext,
        next.iv,
        next.tag,
        next.wrappedDek,
        next.keyVersion,
      ]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

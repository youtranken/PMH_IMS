import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { MasterKeyRing } from '../src/common/crypto/master-key-ring';
import { assertKeyringCovers, countByKeyVersion, rewrapAll } from '../src/ops/rewrap';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DOM-01 (QUYET-DINH Q-07) — xoay master key phải xoay được DỮ LIỆU CŨ, không chỉ dữ liệu mới.
 *
 * Thêm dòng `2=…` vào keyring chỉ làm bản ghi MỚI dùng chìa 2; két và TOTP cũ vẫn nằm ở chìa 1,
 * tức kẻ đang cầm chìa 1 vẫn mở được hết. `rewrapAll` bọc lại từng bản ghi sang chìa hiện hành;
 * xong thì chìa cũ mới thật sự vô dụng và mới được huỷ.
 */

const TEST_TIMEOUT = 120_000;
const K1 = `1=${'a'.repeat(64)}`;
const K2 = `2=${'b'.repeat(64)}`;

describe('DOM-01 · rewrap master key', () => {
  let scratch: ScratchDb;
  const v1 = new EnvelopeCryptoService(new MasterKeyRing(K1));
  const v12 = new EnvelopeCryptoService(new MasterKeyRing(`${K1}\n${K2}`));
  const v2only = new EnvelopeCryptoService(new MasterKeyRing(K2));
  const secretIds: string[] = [];
  let userId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_rewrap');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    // Ba ngăn két và một TOTP, tất cả niêm bằng chìa 1.
    for (let i = 0; i < 3; i += 1) {
      const id = randomUUID();
      const s = v1.seal(`mat-khau-${i}`, { table: 'secret', recordId: id });
      await scratch.pool.query(
        `INSERT INTO secret (id, owner_type, owner_id, kind, label, value_ct, value_iv, value_tag,
                             dek_wrapped, key_version, created_by)
         VALUES ($1, 'device', $2, 'password', $3, $4, $5, $6, $7, $8, 'test')`,
        [id, randomUUID(), `ngăn ${i}`, s.ciphertext, s.iv, s.tag, s.wrappedDek, s.keyVersion],
      );
      secretIds.push(id);
    }
    const u = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ('rw@pmh.com.vn', 'RW', 'sa', 'x')
       RETURNING id`,
    );
    userId = u.rows[0].id;
    const t = v1.seal('JBSWY3DPEHPK3PXP', { table: 'users', recordId: userId });
    await scratch.pool.query(
      `UPDATE users SET totp_secret_ct = $2, totp_secret_iv = $3, totp_secret_tag = $4,
                        totp_dek_wrapped = $5, totp_key_version = $6 WHERE id = $1`,
      [userId, t.ciphertext, t.iv, t.tag, t.wrappedDek, t.keyVersion],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('đếm được bao nhiêu bản ghi ở mỗi version chìa', async () => {
    await expect(countByKeyVersion(scratch.pool)).resolves.toEqual([
      { store: 'secret', keyVersion: 1, count: 3 },
      { store: 'users.totp', keyVersion: 1, count: 1 },
    ]);
  });

  it('API không được khởi động khi keyring thiếu chìa mà dữ liệu còn cần', async () => {
    await expect(assertKeyringCovers(scratch.pool, new MasterKeyRing(K2))).rejects.toThrow(
      /version 1/,
    );
    await expect(assertKeyringCovers(scratch.pool, new MasterKeyRing(`${K1}\n${K2}`))).resolves.toBeUndefined();
  });

  it('rewrap chuyển MỌI bản ghi sang chìa hiện hành; sau đó chìa 1 không còn cần', async () => {
    const result = await rewrapAll(scratch.pool, v12, { batchSize: 2 });
    expect(result).toEqual({ secret: 3, totp: 1 });
    await expect(countByKeyVersion(scratch.pool)).resolves.toEqual([
      { store: 'secret', keyVersion: 2, count: 3 },
      { store: 'users.totp', keyVersion: 2, count: 1 },
    ]);
    // Mở được bằng keyring CHỈ có chìa 2 — tức huỷ chìa 1 là an toàn.
    const { rows } = await scratch.pool.query(
      `SELECT id, value_ct, value_iv, value_tag, dek_wrapped, key_version FROM secret ORDER BY label`,
    );
    const values = rows.map((r: Record<string, Buffer & number & string>) =>
      v2only.openText(
        { ciphertext: r.value_ct, iv: r.value_iv, tag: r.value_tag, wrappedDek: r.dek_wrapped, keyVersion: r.key_version },
        { table: 'secret', recordId: r.id },
      ),
    );
    expect(values).toEqual(['mat-khau-0', 'mat-khau-1', 'mat-khau-2']);
    const u = await scratch.pool.query(
      `SELECT totp_secret_ct, totp_secret_iv, totp_secret_tag, totp_dek_wrapped, totp_key_version FROM users WHERE id = $1`,
      [userId],
    );
    const t = u.rows[0] as Record<string, Buffer & number>;
    expect(
      v2only.openText(
        { ciphertext: t.totp_secret_ct, iv: t.totp_secret_iv, tag: t.totp_secret_tag, wrappedDek: t.totp_dek_wrapped, keyVersion: t.totp_key_version },
        { table: 'users', recordId: userId },
      ),
    ).toBe('JBSWY3DPEHPK3PXP');
  });

  it('chạy lại khi đã xong thì không làm gì (chạy lại được sau khi bị ngắt)', async () => {
    await expect(rewrapAll(scratch.pool, v12, { batchSize: 2 })).resolves.toEqual({ secret: 0, totp: 0 });
  });

  it('mỗi lượt rewrap để lại một dòng audit', async () => {
    const { rows } = await scratch.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'crypto.rewrapped'`,
    );
    expect(rows[0].n).toBe(2);
  });
});

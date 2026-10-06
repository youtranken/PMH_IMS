import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * 0062 đặt UNIQUE trên khoá model chuẩn hoá — chặt hơn chỉ mục của 0054 (theo loại + lower/btrim).
 * DB có sẵn hai hàng nay trùng khoá thì migration phải GỘP chúng (giữ hàng tạo trước, ảnh và tệp ảnh
 * chuyển sang), không được hỏng: migration chỉ tiến, hỏng là API không khởi động.
 */
const TEST_TIMEOUT = 180_000;

describe('Migration 0062 · gộp model trùng khoá chuẩn hoá có sẵn', () => {
  let scratch: ScratchDb;
  let partial: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_model_migration');
    partial = await mkdtemp(join(tmpdir(), 'ims-mig-0061-'));
    const all = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const file of all.filter((f) => f < '0062')) await copyFile(join(migrationsDir(), file), join(partial, file));
    await runMigrations(scratch.pool, partial, { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await rm(partial, { recursive: true, force: true });
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('hai hàng "C9300-48P" / "C9300 48P" (cùng loại) và một hàng khác loại cùng khoá → còn một hàng, giữ ảnh, tệp ảnh chuyển chủ', async () => {
    const q = async (sql: string, params: unknown[] = []) => (await scratch.pool.query<{ id: string }>(sql, params)).rows;
    const user = (await q(`INSERT INTO users (email, full_name, role, password_hash) VALUES ('e2e-mig@qa.test', 'E2E', 'sa', 'x') RETURNING id`))[0].id;
    const sw = (await q(`INSERT INTO device_type (name) VALUES ('Switch E2E MIG') RETURNING id`))[0].id;
    const other = (await q(`INSERT INTO device_type (name) VALUES ('Router E2E MIG') RETURNING id`))[0].id;
    const keeper = (await q(`INSERT INTO device_model (device_type_id, model, created_at) VALUES ($1, 'C9300-48P', now() - interval '2 days') RETURNING id`, [sw]))[0].id;
    const dup = (await q(`INSERT INTO device_model (device_type_id, model, created_at) VALUES ($1, 'C9300 48P', now() - interval '1 day') RETURNING id`, [sw]))[0].id;
    const dupOtherType = (await q(`INSERT INTO device_model (device_type_id, model) VALUES ($1, 'c9300_48p') RETURNING id`, [other]))[0].id;
    const photo = (
      await q(
        `INSERT INTO file (original_name, stored_name, mime_type, size_bytes, owner_type, owner_id, uploaded_by) VALUES ('a.png', 'x', 'image/png', 1, 'device_model', $1, $2) RETURNING id`,
        [dup, user],
      )
    )[0].id;
    await q(`UPDATE device_model SET photo_front_file_id = $1 WHERE id = $2`, [photo, dup]);

    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });

    const rows = await scratch.pool.query<{ id: string; model: string; photo_front_file_id: string | null }>(`SELECT id, model, photo_front_file_id FROM device_model`);
    expect(rows.rows).toEqual([{ id: keeper, model: 'C9300-48P', photo_front_file_id: photo }]);
    expect((await q(`SELECT owner_id AS id FROM file WHERE id = $1`, [photo]))[0].id).toBe(keeper);
    expect([dup, dupOtherType]).not.toContain(rows.rows[0].id);
  });
});

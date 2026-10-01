import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Migration 0041 (Q-20) đổi hai khoá duy nhất của `device_port` sang không phân biệt hoa/thường.
 * Dữ liệu đã có mà trùng theo luật mới thì nó phải DỪNG với câu nói rõ cổng nào, không tự gộp
 * và không chết bằng một lỗi 23505 trơ trọi.
 */

const TEST_TIMEOUT = 120_000;
const TARGET = '0041_device_port_ci.sql';

describe('0041 · dữ liệu trùng khác hoa/thường thì dừng, nói rõ', () => {
  let scratch: ScratchDb;
  let before: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_port_ci_migration');
    before = await mkdtemp(join(tmpdir(), 'ims-0041-'));
    for (const file of await readdir(migrationsDir())) {
      if (file.endsWith('.sql') && file < TARGET) {
        await copyFile(join(migrationsDir(), file), join(before, file));
      }
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    'hai dòng "Gi1/0/1" và "gi1/0/1" trên một máy → migration ném, nêu mã máy và cổng',
    async () => {
      const type = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device_type (name) VALUES ('Switch E2E 0041') RETURNING id`,
      );
      const dev = await scratch.pool.query<{ id: string }>(
        `INSERT INTO device (code, name, device_type_id) VALUES ('SW-E2E-0041', 'x', $1) RETURNING id`,
        [type.rows[0].id],
      );
      await scratch.pool.query(
        `INSERT INTO device_port (device_id, port_label) VALUES ($1, 'Gi1/0/1'), ($1, 'gi1/0/1')`,
        [dev.rows[0].id],
      );
      await copyFile(join(migrationsDir(), TARGET), join(before, TARGET));
      await expect(runMigrations(scratch.pool, before, { log: () => undefined })).rejects.toThrow(
        /0041.*SW-E2E-0041.*cổng "Gi1\/0\/1"/,
      );

      // Dọn tay xong thì chạy lại được.
      await scratch.pool.query(`DELETE FROM device_port WHERE port_label = 'gi1/0/1'`);
      await runMigrations(scratch.pool, before, { log: () => undefined });
    },
    TEST_TIMEOUT,
  );
});

import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * 0046 trên một DB đã chạy bản thử (0043) và đang có bản vẽ thử: bảng thử bị bỏ cùng dữ liệu của
 * nó (Q-23: bản vẽ thử không chuyển sang), bảng thật dựng được, và 0043 không bị đụng tới —
 * checksum của nó trong `_migrations` vẫn khớp nên chạy lại bộ migration không dừng.
 */

const TEST_TIMEOUT = 120_000;
const TARGET = '0046_diagram.sql';

describe('0046 · bỏ bảng bản thử, dựng cây bản vẽ trên DB đã áp 0043', () => {
  let scratch: ScratchDb;
  let before: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_migration');
    before = await mkdtemp(join(tmpdir(), 'ims-0046-'));
    for (const file of await readdir(migrationsDir())) {
      if (file.endsWith('.sql') && file < TARGET) await copyFile(join(migrationsDir(), file), join(before, file));
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
    if (before) await rm(before, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    'có hàng bản thử → 0046 chạy sạch, bảng thử biến mất, chạy lại cả bộ không lỗi',
    async () => {
      await scratch.pool.query(
        `INSERT INTO diagram_spike (name, xml, updated_by) VALUES ('E2E-thu', '<mxfile/>', 'sa@e2e.local')`,
      );
      const applied = await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
      expect(applied).toContain(TARGET);

      const { rows } = await scratch.pool.query<{ spike: string | null; diagram: string | null }>(
        `SELECT to_regclass('public.diagram_spike')::text AS spike, to_regclass('public.diagram')::text AS diagram`,
      );
      expect(rows[0]).toEqual({ spike: null, diagram: 'diagram' });
      await expect(runMigrations(scratch.pool, migrationsDir(), { log: () => undefined })).resolves.toEqual([]);
    },
    TEST_TIMEOUT,
  );
});

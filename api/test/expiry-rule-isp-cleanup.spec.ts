import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DOM-10 (QUYET-DINH Q-10) — đường truyền không còn hạn, nên loại `isp` rời khỏi luật mail.
 *
 * `kinds = []` nghĩa là "mọi loại": gỡ `isp` khỏi một luật chỉ có mỗi `isp` sẽ biến nó thành luật
 * nhắc TẤT CẢ. Nên luật đó bị tắt và giữ nguyên `kinds`; luật có nhiều loại thì chỉ gỡ `isp`.
 */

const TEST_TIMEOUT = 120_000;
const MIGRATION = '0065_expiry_rule_drop_isp.sql';

describe('DOM-10 · gỡ loại isp khỏi luật mail nhắc hạn', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_rule_isp');
    const before = await mkdtemp(join(tmpdir(), 'ims-mig-before-0065-'));
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((name) => name < MIGRATION)) {
      await writeFile(join(before, f), await readFile(join(migrationsDir(), f)));
    }
    await runMigrations(scratch.pool, before, { log: () => undefined });
    await scratch.pool.query(
      `INSERT INTO expiry_rule (name, kinds, frequency, active) VALUES
         ('nhieu-loai', '["ssl","isp"]', 'daily', true),
         ('chi-isp', '["isp"]', 'daily', true),
         ('moi-loai', '[]', 'daily', true),
         ('license', '["license"]', 'daily', true)`,
    );
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it.each([
    ['nhieu-loai', ['ssl'], true],
    ['chi-isp', ['isp'], false],
    ['moi-loai', [], true],
    ['license', ['license'], true],
  ])('luật %s → kinds %j, đang chạy = %s', async (name, kinds, active) => {
    const { rows } = await scratch.pool.query<{ kinds: string[]; active: boolean }>(
      `SELECT kinds, active FROM expiry_rule WHERE name = $1`,
      [name],
    );
    expect(rows[0]).toEqual({ kinds, active });
  });
});

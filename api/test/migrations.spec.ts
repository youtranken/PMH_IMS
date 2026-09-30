import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * DoD GẠCH 5 — "migration chỉ tiến, CHẠY SẠCH TRÊN DB TRẮNG" — cho tới 08/09 KHÔNG có cơ chế
 * kiểm chứng nào.
 *
 * ===== VÌ SAO BÀI KIỂM CŨ KHÔNG KIỂM GÌ =====
 *
 * `migration-runner.spec.ts` dựng một `Pool` giả:
 *
 *     query: jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 }))
 *
 * Postgres không bao giờ đọc chuỗi SQL đó. Nên bài kiểm cũ chứng minh được đúng một điều —
 * runner có gửi chuỗi "BEGIN" đi hay không — và KHÔNG chứng minh được điều người ta tưởng nó
 * chứng minh: rằng MỌI file SQL của dự án hợp lệ.
 *
 * Hai nhánh quan trọng nhất của runner cũng chưa từng chạy, vì journal giả luôn rỗng:
 * nhánh "file đã apply → bỏ qua" và nhánh "checksum lệch → NÉM". Cái thứ hai là hàng rào duy
 * nhất chặn schema drift.
 *
 * ===== VÌ SAO STACK E2E ĐANG CHẠY KHÔNG THAY THẾ ĐƯỢC =====
 *
 * Compose có chạy migration lúc khởi động, nhưng trên một volume ĐÃ CÓ SẴN dữ liệu. File
 * 0007 chỉ chạy đúng nhờ ai đó từng vá tay bảng trên DB dev sẽ vẫn im lặng qua cửa mãi mãi —
 * journal đã ghi rồi, runner bỏ qua. Chỉ một DATABASE TRẮNG mới hỏi được câu của DoD.
 */

const TEST_TIMEOUT = 120_000;

describe('Migration chạy trên DATABASE TRẮNG thật', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_mig');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it(
    'cả bộ migration apply sạch từ số không, đúng thứ tự tên file',
    async () => {
      const onDisk = (await readdir(migrationsDir()))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(onDisk.length).toBeGreaterThanOrEqual(30);

      const applied = await runMigrations(scratch.pool, migrationsDir(), {
        log: () => undefined,
      });

      /*
       * So khớp CẢ DANH SÁCH chứ không chỉ số lượng: runner sắp theo tên chuỗi, và cả quy ước
       * zero-pad NNNN_ tồn tại để thứ tự chuỗi trùng thứ tự số. Chốt đúng dãy này là chốt luôn
       * rằng không file nào bị lặng lẽ bỏ qua.
       */
      expect(applied).toEqual(onDisk);

      // Bảng thật, không phải chỉ dòng journal: một file có thể "apply" mà chẳng tạo ra gì.
      const tables = await scratch.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].n).toBeGreaterThan(20);

      // Không index nào INVALID — đúng cái lưới mà runner tự dựng cho CREATE INDEX CONCURRENTLY.
      const invalid = await scratch.pool.query<{ idx: string }>(
        `SELECT indexrelid::regclass::text AS idx FROM pg_index WHERE NOT indisvalid`,
      );
      expect(invalid.rows).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'chạy lần hai: KHÔNG apply lại file nào (nhánh journal, chưa từng chạy trước 08/09)',
    async () => {
      const again = await runMigrations(scratch.pool, migrationsDir(), {
        log: () => undefined,
      });
      expect(again).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'sửa nội dung một file ĐÃ apply → NÉM vì checksum lệch, không im lặng để schema drift',
    async () => {
      /*
       * Chép cả thư mục migration ra tạm rồi sửa một file — không đụng vào file thật của repo.
       * Journal trong DB đã có checksum của bản gốc, nên bản chép-đã-sửa phải bị chặn.
       */
      const dir = await mkdtemp(join(tmpdir(), 'ims-mig-drift-'));
      const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files) {
        await writeFile(join(dir, f), await readFile(join(migrationsDir(), f)));
      }
      const victim = files[1];
      await writeFile(
        join(dir, victim),
        `${await readFile(join(dir, victim), 'utf8')}\n-- sửa lén sau khi đã apply\n`,
      );

      await expect(
        runMigrations(scratch.pool, dir, { log: () => undefined }),
      ).rejects.toThrow(/checksum lệch/);
    },
    TEST_TIMEOUT,
  );

  it(
    'journal có tên lạ nhưng DB dựng từ bộ đã gộp (Q-17) → không chặn, không apply lại gì',
    async () => {
      await scratch.pool.query(
        `INSERT INTO _migrations (name, checksum) VALUES ('9999_nhanh_khac.sql', 'x')`,
      );
      try {
        expect(
          await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined }),
        ).toEqual([]);
      } finally {
        await scratch.pool.query(`DELETE FROM _migrations WHERE name = '9999_nhanh_khac.sql'`);
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'DB dựng từ bộ migration TRƯỚC lượt gộp (Q-17) → NÉM câu nói rõ phải dựng lại, không chạm lược đồ',
    async () => {
      /*
       * Dựng lại đúng hình dạng DB dev cũ: journal mang tên các file đã bị gộp, và bảng thật đã
       * nằm đó. `0000_extensions.sql` là tên duy nhất trùng giữa hai bộ — không có chốt thì
       * runner chết ở "checksum lệch" và người trực đi tìm một file bị sửa không hề tồn tại.
       */
      const old = await createScratchDb('ims_mig_presquash');
      try {
        await old.pool.query(
          `CREATE TABLE _migrations (name text PRIMARY KEY, checksum text,
             applied_at timestamptz NOT NULL DEFAULT now());
           INSERT INTO _migrations (name, checksum) VALUES
             ('0000_extensions.sql', 'cu'), ('0001_system_config.sql', 'cu'),
             ('0304_fk_child_owner_update.sql', 'cu');
           CREATE TABLE system_config (key text PRIMARY KEY, value jsonb NOT NULL);`,
        );

        await expect(
          runMigrations(old.pool, migrationsDir(), { log: () => undefined }),
        ).rejects.toThrow(/trước lượt gộp migration \(Q-17\).*0001_system_config\.sql.*dựng lại/s);

        const journal = await old.pool.query<{ name: string }>(
          'SELECT name FROM _migrations ORDER BY name',
        );
        expect(journal.rows.map((r) => r.name)).toEqual([
          '0000_extensions.sql',
          '0001_system_config.sql',
          '0304_fk_child_owner_update.sql',
        ]);
        const ext = await old.pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'citext'`);
        expect(ext.rowCount).toBe(0);
      } finally {
        await old.drop();
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'file SQL hỏng → NÉM và KHÔNG để lại nửa vời (transaction rollback thật)',
    async () => {
      /*
       * Vế này chỉ đo được trên Postgres thật. Với `Pool` giả thì `client.query(sql)` không bao
       * giờ ném, nên cả nhánh `catch` + ROLLBACK của runner là code chết trong mọi bài kiểm cũ.
       */
      const fresh = await createScratchDb('ims_mig_bad');
      try {
        const dir = await mkdtemp(join(tmpdir(), 'ims-mig-bad-'));
        await writeFile(
          join(dir, '0001_ok.sql'),
          'CREATE TABLE thu_nghiem (id int PRIMARY KEY);',
        );
        await writeFile(
          join(dir, '0002_hong.sql'),
          'CREATE TABLE hong (id int); CREATE TABLE hong (id int);',
        );

        await expect(
          runMigrations(fresh.pool, dir, { log: () => undefined }),
        ).rejects.toThrow(/0002_hong\.sql thất bại/);

        // File 1 đã commit và còn nguyên; file 2 không để lại bảng nào và không vào journal.
        const journal = await fresh.pool.query<{ name: string }>(
          'SELECT name FROM _migrations ORDER BY name',
        );
        expect(journal.rows.map((r) => r.name)).toEqual(['0001_ok.sql']);
        const leftovers = await fresh.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'hong'`,
        );
        expect(leftovers.rows[0].n).toBe(0);
      } finally {
        await fresh.drop();
      }
    },
    TEST_TIMEOUT,
  );
});

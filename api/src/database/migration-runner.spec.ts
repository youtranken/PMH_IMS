import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { runMigrations } from './migration-runner';

/**
 * PHẠM VI CỦA FILE NÀY — đọc trước khi thêm bài vào đây.
 *
 * `Pool` ở dưới là GIẢ: `client.query()` trả `{rows: [], rowCount: 0}` cho mọi câu lệnh, nên
 * Postgres không bao giờ đọc chuỗi SQL nào. File này chỉ chứng minh được những thứ ở tầng
 * ĐIỀU KHIỂN của runner — có gửi "BEGIN" đi không, có chặn tên file sai format không.
 *
 * Nó KHÔNG chứng minh — dù rất dễ bị hiểu nhầm là có chứng minh — rằng các file
 * migration của dự án hợp lệ. Journal giả luôn rỗng nên nhánh "đã apply rồi" và nhánh
 * "checksum lệch" cũng chưa từng chạy ở đây.
 *
 * Chỗ hỏi những câu đó là `api/test/migrations.spec.ts`: Postgres thật, DATABASE trắng thật,
 * chạy bằng `npm --prefix api run test:db`. Bài kiểm mới đó đỏ ngay khi một file SQL hỏng;
 * mấy bài dưới đây thì không, và sẽ không bao giờ.
 */

describe('runMigrations — validate format tên file (trước khi chạm DB)', () => {
  it('tên không zero-pad NNNN_ → throw, pool không bị gọi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qlts-mig-'));
    await writeFile(join(dir, '10_bad.sql'), 'SELECT 1;');
    const pool = {
      connect: jest.fn(),
    } as unknown as Pool;

    await expect(runMigrations(pool, dir)).rejects.toThrow(/sai format NNNN_/);
    expect(
      (pool as unknown as { connect: jest.Mock }).connect,
    ).not.toHaveBeenCalled();
  });
});

describe('runMigrations — DB dựng từ bộ migration trước lượt gộp (Q-17)', () => {
  /** Journal giả trả đúng các tên cho câu đọc cả journal; mọi câu khác trả rỗng. */
  function poolWithJournal(names: string[], queries: string[]) {
    const client = {
      query: jest.fn((text: unknown) => {
        if (typeof text === 'string') queries.push(text);
        if (typeof text === 'string' && /^SELECT name FROM _migrations$/.test(text.trim())) {
          const rows = names.map((name) => ({ name }));
          return Promise.resolve({ rows, rowCount: rows.length });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: jest.fn(),
    };
    return { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
  }

  it('journal có tên không còn file, và thiếu mốc của bộ đã gộp → NÉM, không chạy file nào', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qlts-mig-'));
    await writeFile(join(dir, '0000_extensions.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0001_app_role.sql'), 'SELECT 1;');
    const queries: string[] = [];
    const pool = poolWithJournal(['0000_extensions.sql', '0001_system_config.sql'], queries);

    await expect(runMigrations(pool, dir, { log: () => undefined })).rejects.toThrow(
      /trước lượt gộp migration \(Q-17\)[\s\S]*0001_system_config\.sql[\s\S]*dựng lại/,
    );
    expect(queries).not.toContain('BEGIN');
    expect(queries.some((q) => q.includes('INSERT INTO _migrations'))).toBe(false);
    // Khoá advisory vẫn được trả dù runner ném giữa chừng.
    expect(queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('journal có tên lạ nhưng ĐÃ có mốc của bộ đã gộp → không chặn (vd DB từng chạy nhánh khác)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qlts-mig-'));
    await writeFile(join(dir, '0000_extensions.sql'), 'SELECT 1;');
    await writeFile(join(dir, '0001_app_role.sql'), 'SELECT 1;');
    const queries: string[] = [];
    const pool = poolWithJournal(['0001_app_role.sql', '0099_nhanh_khac.sql'], queries);

    await expect(runMigrations(pool, dir, { log: () => undefined })).resolves.toBeDefined();
  });
});

describe('runMigrations — marker "-- ims:no-transaction" (story 3.1a, action item epic-2 review)', () => {
  function fakePool(queries: string[]) {
    const client = {
      query: jest.fn((text: unknown) => {
        if (typeof text === 'string') queries.push(text);
        // journal SELECT trả rỗng → file được coi là chưa apply
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: jest.fn(),
    };
    return { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
  }

  it('file KHÔNG marker → wrap BEGIN/COMMIT như cũ', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qlts-mig-'));
    await writeFile(join(dir, '0001_normal.sql'), 'SELECT 1;');
    const queries: string[] = [];
    await runMigrations(fakePool(queries), dir, { log: () => undefined });
    expect(queries).toContain('BEGIN');
    expect(queries).toContain('COMMIT');
  });

  it('file CÓ marker dòng đầu → chạy KHÔNG BEGIN/COMMIT, journal vẫn ghi', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qlts-mig-'));
    await writeFile(
      join(dir, '0001_no_tx.sql'),
      '-- ims:no-transaction\nSELECT 1;',
    );
    const queries: string[] = [];
    await runMigrations(fakePool(queries), dir, { log: () => undefined });
    expect(queries).not.toContain('BEGIN');
    expect(queries).not.toContain('COMMIT');
    expect(queries.some((q) => q.includes('INSERT INTO _migrations'))).toBe(
      true,
    );
  });
});

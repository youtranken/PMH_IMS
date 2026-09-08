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
 * Nó KHÔNG chứng minh — và trước 08/09 đã bị hiểu nhầm là có chứng minh — rằng 40 file
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

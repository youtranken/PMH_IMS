import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldSearch, stripDiacritics } from '@/lib/search-fold';

/**
 * GẤP DẤU TIẾNG VIỆT — bản JS bên web, đối chiếu với BẢNG CHUẨN DÙNG CHUNG.
 *
 * Bài anh em: `api/src/common/search-fold.spec.ts` (Jest) và `api/test/search-norm.spec.ts`
 * (SQL thật). Cả ba đọc CÙNG một file `ops/search-fold-cases.json`, vì ba bản cài đặt ấy
 * không import được lẫn nhau: `api/`, `web/` và Postgres là ba thế giới tách rời.
 *
 * Bài nằm ở `src/test/` chứ không cạnh `src/lib/search-fold.ts`: nó đọc file NGOÀI `web/`,
 * tức là một bài kiểm về HẠ TẦNG dự án chứ không phải về một mô-đun — cùng chỗ với
 * `timezone-pin.test.ts`, vốn canh một dòng cấu hình theo đúng kiểu ấy.
 */
interface FoldCase {
  input: string;
  strip: string;
  fold: string;
}

/**
 * Tìm bảng chuẩn bằng cách ĐI NGƯỢC LÊN từ thư mục làm việc.
 *
 * Không dùng `import.meta.url`: Vite biến đổi mô-đun trước khi Vitest chạy nên `import.meta`
 * mang URL của vite-node, không phải `file://` — `fileURLToPath` ném thẳng "The URL must be
 * of scheme file". Cũng không neo cứng vào `process.cwd()`: bộ kiểm chạy được từ `web/`
 * (`npm test`) lẫn từ gốc repo (`npm --prefix web test`), hai thư mục làm việc khác nhau.
 */
function findCasesFile(): string {
  let dir = process.cwd();
  for (let up = 0; up < 5; up += 1) {
    const candidate = join(dir, 'ops', 'search-fold-cases.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Không tìm thấy ops/search-fold-cases.json từ ' + process.cwd());
}

const CASES_FILE = findCasesFile();

const cases: FoldCase[] = (
  JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { cases: FoldCase[] }
).cases;

describe('gấp dấu tiếng Việt (web)', () => {
  it('bảng chuẩn dùng chung đọc được và không rỗng', () => {
    // Thiếu ô này thì file lạc chỗ = 0 ô chạy = bài vẫn xanh. Xem chú thích bên api.
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('stripDiacritics("$input")', ({ input, strip }) => {
    expect(stripDiacritics(input)).toBe(strip);
  });

  it.each(cases)('foldSearch("$input")', ({ input, fold }) => {
    expect(foldSearch(input)).toBe(fold);
  });

  it('chuỗi rỗng và ASCII đi qua nguyên vẹn', () => {
    expect(foldSearch('')).toBe('');
    expect(foldSearch('Catalyst')).toBe('catalyst');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldSearch, stripDiacritics } from './search-fold';

/**
 * GẤP DẤU TIẾNG VIỆT — bản JS bên api, đối chiếu với BẢNG CHUẨN DÙNG CHUNG (B-01).
 *
 * ===== VÌ SAO ĐỌC FILE THAY VÌ VIẾT BẢNG NGAY TRONG BÀI =====
 *
 * Phép gấp dấu này phải giống HỆT hai bản khác: `web/src/lib/search-fold.ts` và hàm
 * `ims_norm(text)` trong Postgres. Ba nơi ấy không import được lẫn nhau — `api/`, `web/` và
 * DB là ba thế giới tách rời — nên thứ duy nhất chia sẻ được là DỮ LIỆU.
 *
 * Nếu mỗi bài tự viết bảng của mình thì ba bảng sẽ trôi khỏi nhau trong im lặng, và ngày trôi
 * xong thì triệu chứng là: gõ `thiet` ở ô tìm trên trình duyệt ra 3 dòng, gõ đúng chuỗi ấy ở
 * màn khác ra 0 dòng, và không bài kiểm nào đỏ. Đọc chung một file là cách bắt cái trôi ấy
 * ngay tại chỗ nó xảy ra.
 *
 * Bảng chuẩn: `ops/search-fold-cases.json` — mọi hàng trong đó đã đo trên Postgres 17 thật.
 */
interface FoldCase {
  input: string;
  strip: string;
  fold: string;
}

/** `api/src/common/` → lên ba tầng là gốc repo. */
const CASES_FILE = join(__dirname, '..', '..', '..', 'ops', 'search-fold-cases.json');

const cases: FoldCase[] = (
  JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { cases: FoldCase[] }
).cases;

describe('gấp dấu tiếng Việt (api)', () => {
  it('bảng chuẩn dùng chung đọc được và không rỗng', () => {
    // Nếu file đổi chỗ hoặc đổi hình dạng, `it.each` bên dưới sẽ chạy 0 ô và bài vẫn XANH —
    // đúng hình dạng "cổng tự tắt trong im lặng". Ô này là cái chốt chặn điều đó.
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('stripDiacritics("$input") giữ nguyên hoa thường', ({ input, strip }) => {
    expect(stripDiacritics(input)).toBe(strip);
  });

  it.each(cases)('foldSearch("$input") hạ chữ thường', ({ input, fold }) => {
    expect(foldSearch(input)).toBe(fold);
  });

  it('không đụng tới ký tự đại diện của LIKE — thoát chuỗi là việc KHÁC', () => {
    // `escapeLike` lo phần `% _ \`. Gấp dấu mà cũng nuốt luôn mấy ký tự đó thì hai việc dính
    // vào nhau và không ai gỡ ra được nữa.
    expect(foldSearch('100% tải')).toBe('100% tai');
    expect(foldSearch('a_b')).toBe('a_b');
    expect(foldSearch('a\\b')).toBe('a\\b');
  });

  it('chuỗi rỗng và chuỗi thuần ASCII đi qua nguyên vẹn', () => {
    expect(foldSearch('')).toBe('');
    expect(stripDiacritics('')).toBe('');
    expect(stripDiacritics('DM-000123')).toBe('DM-000123');
  });
});

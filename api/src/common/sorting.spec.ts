import { parseSortQuery } from './sorting';

const ALLOWED = ['code', 'name', 'warrantyEnd'] as const;
const FALLBACK = { key: 'code', dir: 'asc' } as const;

describe('parseSortQuery — kẹp tham số sắp xếp về whitelist', () => {
  it.each([
    ['khoá hợp lệ + asc', { sort: 'name', dir: 'asc' }, { key: 'name', dir: 'asc' }],
    ['khoá hợp lệ + desc', { sort: 'name', dir: 'desc' }, { key: 'name', dir: 'desc' }],
    ['thiếu dir → asc', { sort: 'warrantyEnd' }, { key: 'warrantyEnd', dir: 'asc' }],
    ['dir lạ → asc', { sort: 'name', dir: 'lung tung' }, { key: 'name', dir: 'asc' }],
    ['không truyền gì → mặc định', {}, FALLBACK],
    ['khoá không có trong whitelist → mặc định', { sort: 'note', dir: 'desc' }, FALLBACK],
    ['dir hợp lệ nhưng khoá lạ → mặc định CẢ dir', { sort: 'note', dir: 'desc' }, FALLBACK],
  ])('%s', (_label, raw, expected) => {
    expect(parseSortQuery(raw, ALLOWED, FALLBACK)).toEqual(expected);
  });

  /**
   * Tên cột đi thẳng vào ORDER BY. Đây là bài kiểm chống chèn lệnh: mọi thứ ngoài whitelist
   * phải rơi về mặc định, không được lọt xuống tầng dưới dưới bất kỳ hình dạng nào.
   */
  it.each([
    'code; DROP TABLE device',
    'code--',
    "code' OR '1'='1",
    'CODE',
    ' code',
    'code ',
    '__proto__',
    'constructor',
  ])('từ chối khoá nguy hiểm/lệch chuẩn: %s', (evil) => {
    expect(parseSortQuery({ sort: evil, dir: 'desc' }, ALLOWED, FALLBACK)).toEqual(FALLBACK);
  });
});

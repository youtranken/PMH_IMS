import { describe, expect, it } from 'vitest';
import { sortQuery } from './sort-query';

describe('sortQuery — nối tham số sắp xếp cho API', () => {
  it.each([
    ['không sắp gì', [], ''],
    ['tăng dần', [{ id: 'code', desc: false }], 'sort=code&dir=asc'],
    ['giảm dần', [{ id: 'warrantyEnd', desc: true }], 'sort=warrantyEnd&dir=desc'],
    [
      'nhiều cột → chỉ lấy cột đầu',
      [
        { id: 'status', desc: true },
        { id: 'name', desc: false },
      ],
      'sort=status&dir=desc',
    ],
  ])('%s', (_label, sorting, expected) => {
    expect(sortQuery(sorting)).toBe(expected);
  });

  it('mã hoá tên cột — không để ký tự lạ lọt thẳng vào query string', () => {
    expect(sortQuery([{ id: 'a b&c=d', desc: false }])).toBe('sort=a%20b%26c%3Dd&dir=asc');
  });
});

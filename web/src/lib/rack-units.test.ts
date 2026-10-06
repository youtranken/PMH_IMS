import { describe, expect, it } from 'vitest';
import { rackClash, rackPlacement, rackRows, rackUnitLabel, nearestFreeU } from './rack-units';

describe('rackUnitLabel', () => {
  it.each([
    [5, 1, 'U5'],
    [5, 2, 'U5–U6'],
    [5, null, 'U5'],
    [null, null, null],
    [undefined, undefined, null],
  ])('(%s, %s) → %s', (start, size, expected) => {
    expect(rackUnitLabel(start, size)).toBe(expected);
  });
});

const OCC = [
  { id: 'sw', code: 'SW-01', start: 30, size: 1 },
  { id: 'srv', code: 'SRV-01', start: 10, size: 2 },
];

describe('rackClash — chồng U với máy đang ở tủ (cùng luật server: U1 đáy, máy chiếm LÊN trên)', () => {
  it.each([
    [30, 1, null, 'SW-01'],
    [29, 2, null, 'SW-01'],
    [28, 2, null, null],
    [11, 1, null, 'SRV-01'],
    [9, 1, null, null],
    [12, 3, null, null],
    [30, 1, 'sw', null],
  ])('U%s + %sU (bỏ qua %s) → %s', (start, size, self, want) => {
    expect(rackClash({ start, size }, OCC, self)?.code ?? null).toBe(want);
  });
});

describe('rackRows — mặt đứng của tủ, U cao nhất ở trên', () => {
  it('mỗi U một dòng; máy nhiều U chiếm đủ các dòng; tủ không khai chiều cao thì tới U cao nhất đang dùng (tối thiểu 42)', () => {
    const rows = rackRows(12, OCC);
    expect(rows.map((r) => r.u)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(rows.filter((r) => r.occupant?.code === 'SRV-01').map((r) => r.u)).toEqual([11, 10]);
    expect(rackRows(null, OCC)).toHaveLength(42);
    expect(rackRows(null, [{ id: 'x', code: 'X', start: 50, size: 2 }])[0].u).toBe(51);
  });
});

describe('rackPlacement — câu tự giải thích dưới ô U', () => {
  it.each([
    ['30', '1', { key: 'devices.rackAtOne', unit: 'U30' }],
    ['30', '2', { key: 'devices.rackAtMany', unit: 'U30–U31' }],
    ['30', '', null],
    ['', '1', null],
    ['x', '1', null],
  ])('(%j, %j)', (start, size, want) => {
    expect(rackPlacement(start, size)).toEqual(want);
  });
});

describe('nearestFreeU — U bắt đầu còn trống gần chỗ muốn nhất (hộp "Chuyển máy sang tủ này")', () => {
  const occupants = [
    { id: 'a', code: 'SW-01', start: 10, size: 2 },
    { id: 'b', code: 'SW-02', start: 13, size: 1 },
  ];
  it.each([
    { name: 'chỗ muốn còn trống → giữ nguyên', want: 5, size: 1, expected: 5 },
    { name: 'chỗ muốn bị chiếm → U trống gần nhất (dưới trước khi cách đều)', want: 11, size: 1, expected: 12 },
    { name: 'máy 2U không lọt U12–U13, khe kề dưới cũng chiếm → U14–U15', want: 12, size: 2, expected: 14 },
    { name: 'vượt đỉnh tủ → kẹp về chỗ cao nhất còn vừa', want: 42, size: 2, expected: 41 },
    { name: 'chính máy đang chuyển không tính là chiếm chỗ', want: 10, size: 2, expected: 10, self: 'a' },
  ])('$name', ({ want, size, expected, self }) => {
    expect(nearestFreeU(want, size, 42, occupants, self ?? null)).toBe(expected);
  });

  it('tủ đầy → null', () => {
    expect(nearestFreeU(1, 1, 2, [{ id: 'x', code: 'X', start: 1, size: 2 }], null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { clampPage, lastPageOf, pageWindow } from './paging';

describe('lastPageOf — danh sách rỗng vẫn là trang 1', () => {
  it.each([
    [0, 20, 1],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [40, 20, 2],
    [41, 20, 3],
  ])('%i dòng, %i dòng/trang → trang cuối %i', (total, limit, expected) => {
    expect(lastPageOf(total, limit)).toBe(expected);
  });
});

describe('clampPage — không bao giờ đứng trên một trang không tồn tại', () => {
  const cases: { name: string; page: number; total: number; limit: number; expected: number }[] = [
    { name: 'trang trong khoảng thì giữ nguyên', page: 2, total: 254, limit: 50, expected: 2 },
    { name: 'trang cuối vừa khít', page: 6, total: 254, limit: 50, expected: 6 },
    { name: 'trang vượt quá bị kéo về trang cuối', page: 7, total: 254, limit: 50, expected: 6 },
    { name: 'lọc xong còn ít dòng thì về trang 1', page: 5, total: 3, limit: 50, expected: 1 },
    { name: 'danh sách rỗng vẫn là trang 1', page: 3, total: 0, limit: 20, expected: 1 },
    { name: 'trang 0 bị kéo lên 1', page: 0, total: 100, limit: 20, expected: 1 },
    { name: 'trang âm bị kéo lên 1', page: -4, total: 100, limit: 20, expected: 1 },
    // Xoá dòng duy nhất của trang 3 (41 → 40 dòng): trang 3 biến mất, về trang 2.
    { name: 'xoá dòng cuối của trang cuối', page: 3, total: 40, limit: 20, expected: 2 },
    { name: '?page=99 gõ tay trên thanh địa chỉ', page: 99, total: 40, limit: 20, expected: 2 },
  ];

  it.each(cases)('$name', ({ page, total, limit, expected }) => {
    expect(clampPage(page, total, limit)).toBe(expected);
  });
});

describe('pageWindow — dãy số trang có lược "…"', () => {
  it.each<[string, number, number, (number | 'gap')[]]>([
    ['chỉ một trang', 1, 1, [1]],
    ['năm trang, đứng trang 3 — không cần lược', 3, 5, [1, 2, 3, 4, 5]],
    ['giữa dãy dài', 5, 20, [1, 'gap', 4, 5, 6, 'gap', 20]],
    ['đầu dãy dài', 1, 20, [1, 2, 'gap', 20]],
    ['cuối dãy dài', 20, 20, [1, 'gap', 19, 20]],
    // Khoảng lược chỉ một trang thì in luôn số đó: "1 … 3" tốn chỗ y như "1 2 3".
    ['khoảng lược một trang ở đầu', 4, 20, [1, 2, 3, 4, 5, 'gap', 20]],
    ['khoảng lược một trang ở cuối', 17, 20, [1, 'gap', 16, 17, 18, 19, 20]],
    ['trang vượt khoảng thì kẹp về cuối', 99, 6, [1, 'gap', 5, 6]],
  ])('%s', (_ten, page, last, expected) => {
    expect(pageWindow(page, last)).toEqual(expected);
  });
});

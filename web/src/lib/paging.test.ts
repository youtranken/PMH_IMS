import { describe, expect, it } from 'vitest';
import { clampPage, lastPageOf } from './paging';

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

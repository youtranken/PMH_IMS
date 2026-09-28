import { describe, expect, it } from 'vitest';
import { addYearsIso } from '@/lib/add-years';

/* Hạn bảo hành thường là "ngày mua + 1/2/3 năm". Ngày 29/02 cộng năm rơi vào năm không nhuận
   thì lùi về 28/02 — KHÔNG trôi sang 01/03 như `Date.setFullYear`, vì hạn không được dài hơn
   hợp đồng. */
describe('addYearsIso', () => {
  it.each([
    ['2025-03-15', 1, '2026-03-15'],
    ['2025-03-15', 3, '2028-03-15'],
    ['2024-02-29', 1, '2025-02-28'],
    ['2024-02-29', 4, '2028-02-29'],
    ['2025-12-31', 2, '2027-12-31'],
  ])('%s + %i năm = %s', (from, years, expected) => {
    expect(addYearsIso(from, years)).toBe(expected);
  });

  it.each([[''], ['15/03/2025'], ['2025-13-40']])('đầu vào không phải ngày ISO (%s) → chuỗi rỗng', (bad) => {
    expect(addYearsIso(bad, 1)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { foldedMatchRange } from './search-fold';

/**
 * Vị trí đoạn khớp TRONG CHUỖI GỐC (có dấu) — để tô đậm đúng chữ người dùng thấy, trong khi
 * phép so vẫn gấp dấu như mọi ô tìm khác.
 */
describe('foldedMatchRange', () => {
  it.each([
    ['SW-CORE-01', 'core', [3, 7]],
    ['Thiết bị mạng', 'thiet bi', [0, 8]],
    ['Camera cổng chính', 'CONG', [7, 11]],
    ['Đường truyền FPT', 'duong', [0, 5]],
    ['abc', 'x', null],
    ['abc', '', null],
    ['abc', '  ', null],
  ] as const)('%s ~ "%s" → %j', (text, q, range) => {
    expect(foldedMatchRange(text, q)).toEqual(range);
  });
});

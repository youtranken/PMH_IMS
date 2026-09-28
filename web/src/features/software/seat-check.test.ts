import { describe, expect, it } from 'vitest';
import { seatCheck } from './software-types';

/**
 * SW-025 — "10 ghế" hay "1,000" không được thành "không giới hạn" một cách âm thầm.
 * `Number("10 ghế")` là NaN, `JSON.stringify(NaN)` là `null`, và `null` là "không giới hạn".
 */
describe('seatCheck', () => {
  it.each([
    ['', true, 0, { value: null, reason: null }],
    ['   ', true, 0, { value: null, reason: null }],
    ['10', true, 0, { value: 10, reason: null }],
    [' 25 ', true, 3, { value: 25, reason: null }],
    ['10 ghế', true, 0, { value: null, reason: 'invalid' }],
    ['1,000', true, 0, { value: null, reason: 'invalid' }],
    ['1.5', true, 0, { value: null, reason: 'invalid' }],
    ['-3', true, 0, { value: null, reason: 'invalid' }],
    ['0', true, 0, { value: null, reason: 'invalid' }],
    ['5', true, 6, { value: 5, reason: 'belowUsed' }],
    ['6', true, 6, { value: 6, reason: null }],
    // Loại không có ghế: ô bị ẩn, không gửi gì dù còn sót chữ.
    ['abc', false, 0, { value: null, reason: null }],
  ])('%p (có ghế: %p, đang dùng %p) → %o', (raw, hasSeats, used, expected) => {
    expect(seatCheck(raw, hasSeats, used)).toEqual(expected);
  });
});

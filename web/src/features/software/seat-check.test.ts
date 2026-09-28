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

  /*
   * Vượt ghế là trạng thái HỢP LỆ (gán vượt phải ghi lý do). Form chỉ chặn khi lượt sửa ĐỔI
   * tổng xuống dưới số đang dùng — cùng luật `seatConflicts(beforeSeatTotal)` của API. Chặn cả
   * khi tổng giữ nguyên thì license 2/1 không sửa được ghi chú hay ngày hết hạn.
   */
  it.each([
    // Tổng không đổi: license đang vượt vẫn lưu được.
    ['1', 2, 1, { value: 1, reason: null }],
    [' 1 ', 2, 1, { value: 1, reason: null }],
    // Đổi tổng xuống dưới số đang dùng: chặn.
    ['1', 2, 3, { value: 1, reason: 'belowUsed' }],
    // Đổi tổng mà vẫn dưới số đang dùng: API chặn, form cũng chặn (không để server nói sau).
    ['2', 3, 1, { value: 2, reason: 'belowUsed' }],
    // Hồ sơ trước "không giới hạn" giờ đặt trần dưới số đang dùng: là đổi tổng, chặn.
    ['1', 2, null, { value: 1, reason: 'belowUsed' }],
    // Đổi lên đủ số đang dùng: hợp lệ.
    ['3', 3, 1, { value: 3, reason: null }],
  ])('%p, đang dùng %p, tổng cũ %p → %o', (raw, used, before, expected) => {
    expect(seatCheck(raw, true, used, before)).toEqual(expected);
  });
});

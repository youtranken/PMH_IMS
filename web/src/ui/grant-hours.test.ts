import { describe, expect, it } from 'vitest';
import { grantHoursCheck, hourSteps } from './grant-hours';

/**
 * Nấc giờ chọn nhanh — người duyệt chỉ RÚT NGẮN (≤ số xin), người xin chọn trong trần hệ thống.
 * Con số trần/số xin luôn có mặt ở cuối để "đúng như xin" là một cú chạm.
 */
describe('hourSteps', () => {
  it.each([
    [24, [1, 2, 4, 8, 24]],
    [4, [1, 2, 4]],
    [6, [1, 2, 4, 6]],
    [1, [1]],
    [72, [1, 2, 4, 8, 24, 72]],
  ])('giới hạn %p → %o', (limit, expected) => {
    expect(hourSteps(limit)).toEqual(expected);
  });

  it('không rõ giới hạn thì chỉ đưa các nấc ngắn', () => {
    expect(hourSteps(null)).toEqual([1, 2, 4]);
    expect(hourSteps(0)).toEqual([1, 2, 4]);
  });
});

/**
 * Ô "Cấp trong bao lâu" của hộp Duyệt break-glass: rút ngắn được, KÉO DÀI thì không — cùng
 * luật với API (`BreakGlassService.approve` kẹp theo số giờ xin). Báo ngay trên hộp thay vì để
 * server lặng lẽ cấp ít hơn con số người duyệt vừa gõ.
 */
describe('grantHoursCheck', () => {
  it.each([
    ['4', 4, { value: 4, reason: null }],
    [' 2 ', 4, { value: 2, reason: null }],
    ['1', 4, { value: 1, reason: null }],
    ['5', 4, { value: null, reason: 'aboveAsked' }],
    ['24', 4, { value: null, reason: 'aboveAsked' }],
    ['0', 4, { value: null, reason: 'invalid' }],
    ['-1', 4, { value: null, reason: 'invalid' }],
    ['2.5', 4, { value: null, reason: 'invalid' }],
    ['2 tiếng', 4, { value: null, reason: 'invalid' }],
    ['', 4, { value: null, reason: 'invalid' }],
    // Phiếu không mang số giờ hợp lệ: chỉ còn trần cấu hình phía server.
    ['12', null, { value: 12, reason: null }],
  ])('%p (xin %p giờ) → %o', (raw, requested, expected) => {
    expect(grantHoursCheck(raw, requested)).toEqual(expected);
  });
});

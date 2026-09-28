import { describe, expect, it } from 'vitest';
import { grantHoursCheck } from './grant-hours';

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

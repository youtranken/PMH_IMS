import { describe, expect, it } from 'vitest';
import { hourSteps } from './grant-hours';

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

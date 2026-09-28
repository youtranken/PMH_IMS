import { describe, expect, it } from 'vitest';
import { matchPeriod, periodRange } from '@/lib/period-range';

describe('periodRange — khoảng ngày của tháng/quý/năm chứa hôm nay', () => {
  it.each([
    ['month', '2026-09-28', '2026-09-01', '2026-09-30'],
    ['month', '2026-02-10', '2026-02-01', '2026-02-28'],
    ['month', '2028-02-10', '2028-02-01', '2028-02-29'],
    ['quarter', '2026-09-28', '2026-07-01', '2026-09-30'],
    ['quarter', '2026-01-01', '2026-01-01', '2026-03-31'],
    ['quarter', '2026-12-31', '2026-10-01', '2026-12-31'],
    ['year', '2026-09-28', '2026-01-01', '2026-12-31'],
  ] as const)('%s của %s → %s … %s', (period, today, from, to) => {
    expect(periodRange(period, today)).toEqual({ from, to });
  });

  it('nhận ra khoảng đang lọc là preset nào, không khớp thì rỗng', () => {
    expect(matchPeriod('2026-07-01', '2026-09-30', '2026-09-28')).toBe('quarter');
    expect(matchPeriod('2026-09-01', '2026-09-30', '2026-09-28')).toBe('month');
    expect(matchPeriod('2026-09-02', '2026-09-30', '2026-09-28')).toBe('');
    expect(matchPeriod('', '', '2026-09-28')).toBe('');
  });
});

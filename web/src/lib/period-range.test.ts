import { describe, expect, it } from 'vitest';
import {
  daysBetweenIso,
  matchPeriod,
  matchRecent,
  periodRange,
  recentRange,
} from '@/lib/period-range';

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

describe('recentRange — "N ngày gần đây" tính cả hôm nay', () => {
  it.each([
    [1, '2026-09-29', '2026-09-29'],
    [7, '2026-09-29', '2026-09-23'],
    [30, '2026-03-05', '2026-02-04'],
    [7, '2026-01-03', '2025-12-28'],
  ] as const)('%i ngày tới %s bắt đầu từ %s', (days, today, from) => {
    expect(recentRange(days, today)).toEqual({ from, to: today });
  });

  it('nhận ra khoảng đang lọc là preset nào; lệch một đầu là không khớp', () => {
    expect(matchRecent('2026-09-23', '2026-09-29', '2026-09-29', [1, 7, 30])).toBe(7);
    expect(matchRecent('2026-09-29', '2026-09-29', '2026-09-29', [1, 7, 30])).toBe(1);
    expect(matchRecent('2026-09-23', '', '2026-09-29', [1, 7, 30])).toBe(0);
    expect(matchRecent('2026-09-22', '2026-09-29', '2026-09-29', [1, 7, 30])).toBe(0);
  });
});

describe('daysBetweenIso — số ngày lịch giữa hai ngày YYYY-MM-DD', () => {
  it.each([
    ['2026-09-29', '2026-09-29', 0],
    ['2026-09-29', '2026-09-30', 1],
    ['2026-09-29', '2026-12-31', 93],
    ['2026-03-01', '2026-02-28', -1],
    ['2028-02-28', '2028-03-01', 2],
  ] as const)('%s → %s = %i', (from, to, days) => {
    expect(daysBetweenIso(from, to)).toBe(days);
  });
});

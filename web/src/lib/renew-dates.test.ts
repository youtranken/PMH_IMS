import { describe, expect, it } from 'vitest';
import { addMonthsIso, renewMinDate, renewPreset } from './renew-dates';

describe('addMonthsIso', () => {
  it.each([
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2026-12-01', 1, '2027-01-01'],
    ['2026-09-28', 36, '2029-09-28'],
  ])('%s + %i tháng = %s', (from, months, expected) => {
    expect(addMonthsIso(from, months)).toBe(expected);
  });
});

describe('renewMinDate — hạn mới phải SAU hạn cũ và SAU hôm nay (Q-03)', () => {
  it.each([
    ['còn hạn: sau hạn cũ một ngày', '2026-12-01', '2026-09-28', '2026-12-02'],
    ['quá hạn: sau hôm nay một ngày', '2026-09-17', '2026-09-28', '2026-09-29'],
    ['hết hạn đúng hôm nay', '2026-09-28', '2026-09-28', '2026-09-29'],
    ['cuối tháng sang tháng sau', '2026-01-31', '2026-01-01', '2026-02-01'],
  ])('%s', (_name, end, today, expected) => {
    expect(renewMinDate(end, today)).toBe(expected);
  });
});

describe('renewPreset — nút +N tháng tính từ hạn cũ, hoặc từ hôm nay nếu đã quá hạn', () => {
  it.each([
    ['còn hạn +12', '2026-12-01', '2026-09-28', 12, '2027-12-01'],
    ['quá hạn +12 tính từ hôm nay', '2026-09-17', '2026-09-28', 12, '2027-09-28'],
    ['còn hạn +1', '2026-12-01', '2026-09-28', 1, '2027-01-01'],
  ])('%s', (_name, end, today, months, expected) => {
    expect(renewPreset(end, today, months)).toBe(expected);
  });
});

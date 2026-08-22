import { describe, expect, it } from 'vitest';
import { daysUntil, expiryLabel, expiryLevel } from './expiry';

// 22/08/2026, 23:30 giờ VN — cố tình để cuối ngày để bắt lỗi tính theo 24h thay vì theo ngày lịch.
const NOW = new Date(2026, 7, 22, 23, 30);

describe('daysUntil — đếm theo ngày lịch, không theo 24 giờ', () => {
  it.each([
    ['2026-08-22', 0],
    ['2026-08-23', 1],
    ['2026-08-21', -1],
    ['2026-09-21', 30],
    ['2026-08-15', -7],
  ])('%s → %i ngày', (end, expected) => {
    expect(daysUntil(end, NOW)).toBe(expected);
  });
});

describe('expiryLevel — một luật cho toàn hệ thống (AD-15)', () => {
  it.each([
    ['2026-08-20', 'expired'],
    ['2026-08-22', 'critical'],
    ['2026-08-29', 'critical'],
    ['2026-08-30', 'warning'],
    ['2026-09-21', 'warning'],
    ['2026-09-22', 'ok'],
    ['2027-01-01', 'ok'],
  ])('%s → %s', (end, expected) => {
    expect(expiryLevel(end, NOW)).toBe(expected);
  });

  it('không có ngày hết hạn → "none", không phải "ok"', () => {
    expect(expiryLevel(null, NOW)).toBe('none');
    expect(expiryLevel(undefined, NOW)).toBe('none');
  });

  it('ngưỡng chỉnh được (khớp luật digest cấu hình ở system_config)', () => {
    const strict = { criticalDays: 30, warningDays: 90 };
    expect(expiryLevel('2026-09-10', NOW, strict)).toBe('critical');
    expect(expiryLevel('2026-11-01', NOW, strict)).toBe('warning');
  });
});

describe('expiryLabel', () => {
  it.each([
    ['2026-08-22', 'Hết hạn hôm nay'],
    ['2026-08-23', 'Còn 1 ngày'],
    ['2026-08-30', 'Còn 8 ngày'],
    ['2026-08-20', 'Quá hạn 2 ngày'],
  ])('%s → %s', (end, expected) => {
    expect(expiryLabel(end, NOW)).toBe(expected);
  });

  it('không có hạn thì nói rõ, không để trống', () => {
    expect(expiryLabel(null, NOW)).toBe('Không có hạn');
  });
});

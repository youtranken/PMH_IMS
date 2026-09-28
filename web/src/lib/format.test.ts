import { describe, expect, it } from 'vitest';
import {
  agoParts,
  formatDateTime,
  formatMoney,
  orDash,
  remainingParts,
  todayIso,
} from './format';

/* Ngày TRƯỚC giờ, như cách người Việt đọc và như mọi ô "ngày" khác của app; `vi-VN` của Intl
   in giờ trước ("23:16 27/09/2026"). Giờ Việt Nam, không phải UTC. */
describe('formatDateTime', () => {
  it.each([
    ['2026-09-27T16:16:00Z', '27/09/2026 23:16'],
    ['2026-01-01T00:05:00Z', '01/01/2026 07:05'],
  ])('%s → %s', (iso, expected) => {
    expect(formatDateTime(iso)).toBe(expected);
  });
  it('rỗng hoặc hỏng → dấu gạch', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('xyz')).toBe('—');
  });
});

describe('formatMoney — tiền đồng dùng chung (AD-15)', () => {
  it.each([
    [0, '0 ₫'],
    [1_000, '1.000 ₫'],
    [3_500_000, '3.500.000 ₫'],
    [12_000_000, '12.000.000 ₫'],
    [999_999_999_999, '999.999.999.999 ₫'],
  ])('%s → %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });

  /**
   * "Chưa khai chi phí" và "được tặng, giá 0đ" là hai chuyện khác nhau. Cho `null` ra
   * "0 ₫" là bịa ra một con số chưa ai nhập.
   */
  it.each([[null], [undefined]])('%s → dấu gạch, KHÔNG phải 0 ₫', (value) => {
    expect(formatMoney(value)).toBe('—');
  });

  it('NaN không lọt ra màn hình dưới dạng "NaN ₫"', () => {
    expect(formatMoney(Number.NaN)).toBe('—');
  });

  /** Ký hiệu ₫ phải dính bằng dấu cách THƯỜNG — chuỗi khớp được, xuống dòng được. */
  it('dùng dấu cách thường trước ₫, không phải cách không ngắt', () => {
    expect(formatMoney(1_000).includes(' ')).toBe(false);
  });
});

describe('orDash', () => {
  it.each([[null], [undefined], ['']])('%s → dấu gạch', (value) => {
    expect(orDash(value)).toBe('—');
  });

  it('số 0 KHÔNG bị coi là rỗng', () => {
    expect(orDash(0)).toBe('0');
  });
});

describe('todayIso — "hôm nay" theo giờ Việt Nam', () => {
  it.each([
    // 23:30 UTC ngày 27 đã là 06:30 sáng ngày 28 ở VN — đây là chỗ `toISOString()` lùi một ngày.
    ['2026-09-27T23:30:00Z', '2026-09-28'],
    ['2026-09-28T16:59:59Z', '2026-09-28'],
    ['2026-09-28T17:00:00Z', '2026-09-29'],
  ])('%s → %s', (now, expected) => {
    expect(todayIso(new Date(now))).toBe(expected);
  });
});

/**
 * "Gửi 4 phút trước" trên phiếu duyệt — người trực đọc được ngay phiếu đã chờ bao lâu. Làm tròn
 * XUỐNG: "1 giờ trước" cho phiếu 59 phút là nói quá. Đồng hồ máy lệch về tương lai thì không
 * được ra số âm.
 */
describe('agoParts', () => {
  const now = Date.parse('2026-09-28T10:00:00.000Z');
  it.each([
    ['2026-09-28T10:00:00.000Z', { unit: 'now', count: 0 }],
    ['2026-09-28T09:59:31.000Z', { unit: 'now', count: 0 }],
    ['2026-09-28T09:59:00.000Z', { unit: 'minutes', count: 1 }],
    ['2026-09-28T09:56:00.000Z', { unit: 'minutes', count: 4 }],
    ['2026-09-28T09:00:01.000Z', { unit: 'minutes', count: 59 }],
    ['2026-09-28T09:00:00.000Z', { unit: 'hours', count: 1 }],
    ['2026-09-27T10:00:01.000Z', { unit: 'hours', count: 23 }],
    ['2026-09-27T10:00:00.000Z', { unit: 'days', count: 1 }],
    ['2026-09-28T10:05:00.000Z', { unit: 'now', count: 0 }],
  ])('%s → %j', (from, expected) => {
    expect(agoParts(from, now)).toEqual(expected);
  });

  it('giá trị hỏng → null, không bịa "vừa xong"', () => {
    expect(agoParts('không phải ngày', now)).toBeNull();
  });
});

/** "còn 3 giờ 52 phút" của quyền đang chạy — không bao giờ âm. */
describe('remainingParts', () => {
  it.each([
    [13_920, { hours: 3, minutes: 52, seconds: 0 }],
    [3_600, { hours: 1, minutes: 0, seconds: 0 }],
    [3_599, { hours: 0, minutes: 59, seconds: 59 }],
    [45, { hours: 0, minutes: 0, seconds: 45 }],
    [0, { hours: 0, minutes: 0, seconds: 0 }],
    [-10, { hours: 0, minutes: 0, seconds: 0 }],
    [12.7, { hours: 0, minutes: 0, seconds: 12 }],
  ])('%d giây → %j', (seconds, expected) => {
    expect(remainingParts(seconds)).toEqual(expected);
  });
});

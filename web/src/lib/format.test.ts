import { describe, expect, it } from 'vitest';
import { formatMoney, orDash, todayIso } from './format';

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

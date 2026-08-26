import { describe, expect, it } from 'vitest';
import { formatMoney, orDash } from './format';

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

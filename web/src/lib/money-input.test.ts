import { describe, expect, it } from 'vitest';
import { formatMoneyInput, parseMoneyInput } from './money-input';

describe('parseMoneyInput — ô tiền nhận cách gõ người ta chép từ hoá đơn (SW-052)', () => {
  it.each([
    ['', null, null],
    ['   ', null, null],
    ['5600000', 5_600_000, null],
    ['5.600.000', 5_600_000, null],
    ['5,600,000', 5_600_000, null],
    ['5 600 000', 5_600_000, null],
    ['5.600.000 ₫', 5_600_000, null],
    ['5600000đ', 5_600_000, null],
    ['5.6tr', 5_600_000, null],
    ['5,6 tr', 5_600_000, null],
    ['12 triệu', 12_000_000, null],
    ['350k', 350_000, null],
    ['0', 0, null],
    ['abc', null, 'invalid'],
    ['5.60.000', null, 'invalid'],
    ['-100', null, 'invalid'],
    ['1.5', null, 'invalid'],
  ])('"%s" → %s', (raw, value, reason) => {
    expect(parseMoneyInput(raw)).toEqual({ value, reason });
  });
});

describe('formatMoneyInput — hiện lại dạng có dấu chấm hàng nghìn', () => {
  it.each([
    [5_600_000, '5.600.000'],
    [0, '0'],
    [null, ''],
  ])('%s → "%s"', (value, text) => {
    expect(formatMoneyInput(value)).toBe(text);
  });
});

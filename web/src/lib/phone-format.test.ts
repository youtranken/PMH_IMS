import { describe, it, expect } from 'vitest';
import { formatPhone, telHref } from '@/lib/phone-format';

describe('formatPhone — tách nhóm số điện thoại cho dễ đọc', () => {
  it.each([
    ['0912345678', '0912 345 678'],
    ['0912 345 678', '0912 345 678'],
    ['02838221234', '028 3822 1234'],
    ['19006600', '1900 6600'],
    ['18001091', '1800 1091'],
    ['1900545415', '1900 5454 15'],
    ['+84912345678', '+84 912 345 678'],
    ['+842838221234', '+84 28 3822 1234'],
    ['113', '113'],
    ['', ''],
    ['123456789012345', '123456789012345'],
  ])('%s → %s', (raw, expected) => {
    expect(formatPhone(raw)).toBe(expected);
  });

  it('bỏ qua null/undefined', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});

describe('telHref', () => {
  it('chỉ giữ chữ số và dấu +', () => {
    expect(telHref('+84 912 345 678')).toBe('tel:+84912345678');
  });
});

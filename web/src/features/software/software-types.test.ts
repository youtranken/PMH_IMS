import { describe, expect, it } from 'vitest';
import { codePrefix, requiresEndDate } from './software-types';

describe('requiresEndDate — khớp `requiresEndDate` phía API (SW-028)', () => {
  it.each([
    ['license', 'subscription', true],
    ['license', 'perpetual', false],
    ['ssl', 'subscription', true],
    ['domain', 'subscription', true],
    ['maintenance', 'subscription', false],
    ['other', 'subscription', false],
  ] as const)('%s / %s → %s', (kind, model, expected) => {
    expect(requiresEndDate(kind, model)).toBe(expected);
  });
});

describe('codePrefix — gợi ý tiền tố mã theo loại (SW-026)', () => {
  it.each([
    ['license', 'LIC-'],
    ['ssl', 'SSL-'],
    ['domain', 'DOM-'],
    ['maintenance', 'MNT-'],
    ['other', ''],
  ] as const)('%s → "%s"', (kind, prefix) => {
    expect(codePrefix(kind)).toBe(prefix);
  });
});

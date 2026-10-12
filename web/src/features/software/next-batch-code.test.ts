import { describe, expect, it } from 'vitest';
import { nextBatchCode } from './software-types';

/** Mã đợt mua kế tiếp (Q-27): mỗi đợt một hồ sơ, mã gợi ý không được trùng mã đã có. */
describe('nextBatchCode', () => {
  it.each([
    ['LIC-WIN25-01', [], 'LIC-WIN25-02'],
    ['LIC-WIN25-09', [], 'LIC-WIN25-10'],
    ['LIC-WIN25-01', ['LIC-WIN25-02', 'lic-win25-03'], 'LIC-WIN25-04'],
    ['LIC-WIN25', [], 'LIC-WIN25-02'],
    ['SW7', [], 'SW7-02'],
    ['LIC_OFFICE_2', [], 'LIC_OFFICE_3'],
    ['LIC-A-099', [], 'LIC-A-100'],
  ] as const)('%s (đã có %j) → %s', (code, taken, expected) => {
    expect(nextBatchCode(code, taken)).toBe(expected);
  });
});

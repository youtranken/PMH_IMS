import { nextCode } from './next-code';

/** FM-21: gợi ý mã kế tiếp theo mã vừa thêm — giữ tiền tố và độ dài số, nhảy qua mã đã có. */
describe('nextCode', () => {
  it.each([
    ['PC-HCM-012', [], 'PC-HCM-013'],
    ['PC-HCM-099', [], 'PC-HCM-100'],
    ['SW7', [], 'SW8'],
    ['LIC-E2E-009', ['LIC-E2E-010', 'lic-e2e-011'], 'LIC-E2E-012'],
    ['ISP-HN-1A', [], null],
    ['ROUTER', [], null],
    [null, [], null],
  ] as const)('%s (đã có %j) → %s', (last, taken, expected) => {
    expect(nextCode(last, taken)).toBe(expected);
  });
});

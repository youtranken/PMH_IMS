import { describe, expect, it } from 'vitest';
import { suggestCabinetCode } from './cabinet-code';

describe('suggestCabinetCode — gợi ý mã tủ TU-<SITE>-NN', () => {
  it.each([
    ['site chưa có tủ nào', 'E2E-HCM', [], 'TU-E2E-HCM-01'],
    ['số kế tiếp sau số lớn nhất', 'E2E-HCM', ['TU-E2E-HCM-01', 'TU-E2E-HCM-03'], 'TU-E2E-HCM-04'],
    ['không phân biệt hoa thường', 'e2e-hcm', ['tu-e2e-hcm-07'], 'TU-E2E-HCM-08'],
    ['bỏ qua mã không theo quy ước', 'HO', ['R01', 'TU-HO-A', 'TU-HO-02'], 'TU-HO-03'],
    ['tủ của site khác không tính', 'HO', ['TU-HO2-09', 'TU-NM-05'], 'TU-HO-01'],
    ['quá 99 thì cứ tăng tiếp', 'HO', ['TU-HO-99'], 'TU-HO-100'],
  ])('%s', (_case, site, codes, expected) => {
    expect(suggestCabinetCode(site, codes)).toBe(expected);
  });
});

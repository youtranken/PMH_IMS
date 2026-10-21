import { FILE_OWNER_TYPES } from './files.service';
import { FILE_FEATURES } from './file-features';

describe('Q-31 · đính kèm thuộc mảng của chủ thể', () => {
  it.each([
    ['device', ['assets']],
    ['isp', ['assets']],
    ['software', ['assets']],
    ['service_account', ['assets']],
    ['device_model', ['assets']],
    ['software_seat', ['assets']],
    ['subnet', ['network']],
    ['nat_rule', ['network']],
    // Kỳ thuộc một phiếu cụ thể: chủ module ISO lọc tiếp theo phiếu (`assertFeatureVisible`).
    ['iso_period', ['iso']],
    ['iso_incident', ['iso_0206']],
  ] as const)('%s → %j', (ownerType, features) => {
    expect(FILE_FEATURES[ownerType]).toEqual(features);
  });

  it('mọi loại chủ thể đính kèm đều thuộc một mảng', () => {
    expect(Object.keys(FILE_FEATURES).sort()).toEqual([...FILE_OWNER_TYPES].sort());
  });
});

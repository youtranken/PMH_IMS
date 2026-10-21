import { describe, expect, it } from 'vitest';
import { canSee, FEATURE_TICKS, featureOfPath } from './features';
import { PATHS } from './routes';

describe('Nhóm quyền phía web (Q-31)', () => {
  it('bảy ô tick, đúng thứ tự và đúng khóa của API (`api/src/common/features.ts`)', () => {
    expect(FEATURE_TICKS).toEqual(['overview', 'assets', 'network', 'iso_0203', 'iso_0206', 'iso_0208', 'break_glass']);
  });

  it.each([
    [null, ['assets'], true],
    [['network'], ['assets'], false],
    [['network'], ['assets', 'network'], true],
    [['overview'], [], true],
  ] as const)('features %j cần một trong %j → %p', (features, required, expected) => {
    expect(canSee({ features: features as string[] | null }, ...required)).toBe(expected);
  });

  it('chưa có `me` thì không thấy gì', () => {
    expect(canSee(null, 'assets')).toBe(false);
  });

  it.each([
    [PATHS.dashboard, ['overview']],
    [PATHS.expiry, ['expiry']],
    [PATHS.devices, ['assets']],
    ['/devices/abc', ['assets']],
    [PATHS.domains, ['assets']],
    [PATHS.adminCatalog, ['assets']],
    [PATHS.disposal, ['assets']],
    ['/ip-addresses/xyz', ['network']],
    ['/diagrams/1/present', ['network']],
    [PATHS.isoBackup, ['iso_0203']],
    [PATHS.isoIncidentNew, ['iso_0206']],
    [PATHS.isoPeriods, ['iso']],
    // Danh mục phiếu chỉ có job 0203 và bộ phận 0208 — nhóm chỉ có 0206 thì không có gì để xem.
    [PATHS.isoCatalog, ['iso_0203', 'iso_0208']],
    [PATHS.approvals, ['break_glass']],
    ['/approvals/123', ['break_glass']],
  ])('%s thuộc %j', (path, features) => {
    expect(featureOfPath(path)).toEqual(features);
  });

  it.each([PATHS.profile, PATHS.adminAccounts, PATHS.vault, '/khong-co'])(
    '%s không thuộc mảng nào',
    (path) => {
      expect(featureOfPath(path)).toBeNull();
    },
  );

  it('`/` chỉ khớp đúng chính nó, không là tiền tố của mọi đường', () => {
    expect(featureOfPath('/profile')).toBeNull();
  });
});

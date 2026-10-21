import { effectiveFeatures, FEATURE_TICKS, hasFeature, holdingConflicts, isFeatureTick } from './features';

describe('Nhóm quyền của Thành viên (Q-31)', () => {
  it('đúng 7 ô tick, đúng thứ tự trên màn', () => {
    expect(FEATURE_TICKS).toEqual([
      'overview',
      'assets',
      'network',
      'iso_0203',
      'iso_0206',
      'iso_0208',
      'break_glass',
    ]);
  });

  it.each([
    ['overview', true],
    ['iso_0206', true],
    // Hai khóa suy ra không phải ô tick: không ai được lưu chúng vào nhóm.
    ['expiry', false],
    ['iso', false],
    ['vault', false],
    ['', false],
  ])('isFeatureTick(%p) = %p', (key, expected) => {
    expect(isFeatureTick(key)).toBe(expected);
  });

  describe('effectiveFeatures', () => {
    it.each([
      // SA/Admin luôn đủ, kể cả khi lỡ có nhóm.
      ['sa', ['network'], null],
      ['admin', ['network'], null],
      // Member chưa gán nhóm = đủ quyền như trước Q-31.
      ['member', null, null],
      ['member', ['network'], ['network']],
      // Sắp hết hạn cần CẢ Tổng quan lẫn Tài sản.
      ['member', ['overview'], ['overview']],
      ['member', ['assets'], ['assets']],
      ['member', ['overview', 'assets'], ['overview', 'assets', 'expiry']],
      // Kỳ phiếu & danh mục phiếu hiện khi có ≥1 phiếu.
      ['member', ['iso_0206'], ['iso_0206', 'iso']],
      ['member', ['iso_0203', 'iso_0206'], ['iso_0203', 'iso_0206', 'iso']],
      // 0203 / 0208 kéo theo 0206: ô ✗ cần phiếu sự cố thì kỳ mới chốt được.
      ['member', ['iso_0208'], ['iso_0206', 'iso_0208', 'iso']],
      ['member', ['iso_0203'], ['iso_0203', 'iso_0206', 'iso']],
      // Khóa lạ trong DB (đổi tên sau này) bị bỏ, không mở thêm gì.
      ['member', ['network', 'bogus'], ['network']],
    ] as const)('%s + %j → %j', (role, ticks, expected) => {
      expect(effectiveFeatures(role, ticks as readonly string[] | null)).toEqual(expected);
    });
  });

  describe('hasFeature', () => {
    it.each([
      [null, ['assets'], true],
      [['network'], ['assets'], false],
      [['network'], ['assets', 'network'], true],
      [['overview', 'assets', 'expiry'], ['expiry'], true],
      [['overview'], ['expiry'], false],
    ] as const)('%j cần một trong %j → %p', (features, required, expected) => {
      expect(hasFeature(features as readonly string[] | null, required)).toBe(expected);
    });
  });
});

describe('holdingConflicts — người phụ trách phải thấy phiếu (Q-31)', () => {
  const holdings = [
    { userId: 'an', feature: 'iso_0203' as const, label: '0203' },
    { userId: 'an', feature: 'iso_0208' as const, label: '0208' },
    { userId: 'binh', feature: 'iso_0208' as const, label: '0208' },
  ];

  it.each([
    ['ai cũng đủ quyền', { an: null, binh: null }, []],
    ['An mất 0203', { an: ['iso_0208'], binh: null }, ['an:iso_0203']],
    ['cả hai mất 0208', { an: ['iso_0203'], binh: ['network'] }, ['an:iso_0208', 'binh:iso_0208']],
    // Người không có trong bảng tra (không bị đổi lần này) thì không xét.
    ['chỉ xét người được hỏi', { binh: ['assets'] }, ['binh:iso_0208']],
  ] as const)('%s', (_name, ticks, expected) => {
    const lookup = new Map(Object.entries(ticks) as [string, readonly string[] | null][]);
    expect(holdingConflicts(holdings, lookup).map((h) => `${h.userId}:${h.feature}`)).toEqual(expected);
  });
});

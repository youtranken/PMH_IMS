import {
  ACCESS_TIERS,
  groupsOfDevice,
  groupsOfIsp,
  groupsOfSoftware,
  resolveTier,
  tierLabel,
  type AccessRule,
} from './access-tier';

function rule(over: Partial<AccessRule> = {}): AccessRule {
  return {
    memberEmail: 'it01@pmh.com.vn',
    scopeType: 'device_site',
    scopeRef: 'site-hn',
    tier: 'whitelist',
    ...over,
  };
}

describe('groupsOfDevice — một thiết bị thuộc những nhóm nào', () => {
  it('thuộc cả nhóm theo SITE lẫn nhóm theo LOẠI', () => {
    expect(groupsOfDevice({ siteId: 'site-hn', deviceTypeId: 'type-switch' })).toEqual([
      { scopeType: 'device_site', scopeRef: 'site-hn' },
      { scopeType: 'device_type', scopeRef: 'type-switch' },
    ]);
  });

  /** Thiết bị chưa gắn site (mới nhập, chưa xếp chỗ) vẫn phải thuộc nhóm theo loại. */
  it('thiếu site thì chỉ còn nhóm theo loại, không đẻ ra nhóm rỗng', () => {
    expect(groupsOfDevice({ siteId: null, deviceTypeId: 'type-switch' })).toEqual([
      { scopeType: 'device_type', scopeRef: 'type-switch' },
    ]);
  });

  it('thiếu cả hai thì không thuộc nhóm nào — và như vậy là CẤM mặc định', () => {
    expect(groupsOfDevice({ siteId: null, deviceTypeId: null })).toEqual([]);
  });
});

describe('groupsOfSoftware', () => {
  it('nhóm theo LOẠI hồ sơ phần mềm', () => {
    expect(groupsOfSoftware({ kind: 'license' })).toEqual([
      { scopeType: 'software_kind', scopeRef: 'license' },
    ]);
  });
});

/**
 * SEC-13: đường truyền nhóm theo ID nhà mạng trong danh mục, không theo tên — đổi tên nhà mạng
 * không được lặng lẽ tước quyền đã gán.
 */
describe('groupsOfIsp', () => {
  it('nhóm theo id nhà mạng', () => {
    expect(groupsOfIsp({ providerId: 'prov-1' })).toEqual([
      { scopeType: 'isp_provider', scopeRef: 'prov-1' },
    ]);
  });

  it('không có id (đường truyền không tra được) thì không thuộc nhóm nào', () => {
    expect(groupsOfIsp({ providerId: '' })).toEqual([]);
  });
});

/**
 * AC 6.2: "đối tượng không thuộc tầng nào với member đó = tầng CẤM mặc định (không xin được)".
 *
 * Đây là AD-9 (quyền mặc định đóng) áp vào dữ liệu thay vì vào route. Mặc định phải là CẤM,
 * không phải "cần duyệt": nếu mặc định là cần duyệt thì một member mới toanh, chưa ai gán gì,
 * đã có thể gửi yêu cầu xin mật khẩu mọi thiết bị trong công ty — và người duyệt lãnh một
 * đống yêu cầu không nên tồn tại.
 */
describe('resolveTier — không có luật nào = CẤM', () => {
  const groups = [
    { scopeType: 'device_site' as const, scopeRef: 'site-hn' },
    { scopeType: 'device_type' as const, scopeRef: 'type-switch' },
  ];

  it('không có luật nào → cấm', () => {
    expect(resolveTier([], 'it01@pmh.com.vn', groups)).toBe('denied');
  });

  it('luật của NGƯỜI KHÁC không áp cho mình', () => {
    expect(resolveTier([rule({ memberEmail: 'it02@pmh.com.vn' })], 'it01@pmh.com.vn', groups)).toBe(
      'denied',
    );
  });

  it('luật cho nhóm mình KHÔNG thuộc thì không áp', () => {
    const other = rule({ scopeType: 'device_site', scopeRef: 'site-sg' });
    expect(resolveTier([other], 'it01@pmh.com.vn', groups)).toBe('denied');
  });

  it('khớp nhóm theo site → đúng tầng đã gán', () => {
    expect(resolveTier([rule({ tier: 'whitelist' })], 'it01@pmh.com.vn', groups)).toBe('whitelist');
    expect(resolveTier([rule({ tier: 'needs_approval' })], 'it01@pmh.com.vn', groups)).toBe(
      'needs_approval',
    );
  });

  it('khớp nhóm theo loại cũng được — hai đường vào một đối tượng', () => {
    const byType = rule({ scopeType: 'device_type', scopeRef: 'type-switch', tier: 'whitelist' });
    expect(resolveTier([byType], 'it01@pmh.com.vn', groups)).toBe('whitelist');
  });

  /**
   * Hai luật cùng áp thì lấy cái RỘNG NHẤT.
   *
   * SA gán "mọi switch = xem thẳng" rồi lại gán "site HN = cần duyệt". Lấy cái chặt hơn thì
   * người trực đứng trước con switch ở HN vẫn phải xin — trong khi SA đã nói rõ họ được xem
   * mọi switch. Người ta gán thêm luật để MỞ, không phải để siết; siết thì gỡ luật cũ đi.
   */
  it('nhiều luật cùng áp → lấy tầng RỘNG NHẤT', () => {
    const rules = [
      rule({ scopeType: 'device_site', scopeRef: 'site-hn', tier: 'needs_approval' }),
      rule({ scopeType: 'device_type', scopeRef: 'type-switch', tier: 'whitelist' }),
    ];
    expect(resolveTier(rules, 'it01@pmh.com.vn', groups)).toBe('whitelist');
    expect(resolveTier([...rules].reverse(), 'it01@pmh.com.vn', groups)).toBe('whitelist');
  });

  it('đối tượng không thuộc nhóm nào (thiếu site và loại) → cấm, dù member có đủ luật', () => {
    expect(resolveTier([rule({ tier: 'whitelist' })], 'it01@pmh.com.vn', [])).toBe('denied');
  });

  /** Email so KHÔNG phân biệt hoa-thường: `IT01@` và `it01@` là một người. */
  it('email khác hoa-thường vẫn là cùng một người', () => {
    expect(resolveTier([rule({ memberEmail: 'IT01@PMH.COM.VN' })], 'it01@pmh.com.vn', groups)).toBe(
      'whitelist',
    );
  });
});

describe('tierLabel', () => {
  it.each([
    ['whitelist', 'Xem thẳng'],
    ['needs_approval', 'Cần duyệt'],
    ['denied', 'Không có quyền'],
  ])('%s → %s', (tier, expected) => {
    expect(tierLabel(tier)).toBe(expected);
  });

  it('mọi tầng khai báo đều có nhãn', () => {
    for (const tier of ACCESS_TIERS) {
      expect(tierLabel(tier)).toBeTruthy();
    }
  });
});

import { explainTier, resolveTier, type AccessGroup, type AccessRule } from './access-tier';

function rule(over: Partial<AccessRule> = {}): AccessRule {
  return {
    memberEmail: 'it01@pmh.com.vn',
    scopeType: 'device_site',
    scopeRef: 'site-hn',
    tier: 'whitelist',
    ...over,
  };
}

const DEVICE_HN_SWITCH: AccessGroup[] = [
  { scopeType: 'device_site', scopeRef: 'site-hn' },
  { scopeType: 'device_type', scopeRef: 'type-switch' },
];

/*
 * "Người X có xem được két của máy Y không, VÌ SAO" — màn Kiểm tra quyền phải chỉ đúng dòng quyền
 * sinh ra kết quả, không chỉ tầng. `explainTier` trả thêm các dòng đã khớp, dòng thắng đứng đầu.
 */
describe('explainTier — tầng + dòng quyền nào sinh ra nó', () => {
  it('không dòng nào khớp → cấm, danh sách rỗng', () => {
    expect(explainTier([rule({ scopeRef: 'site-hcm' })], 'it01@pmh.com.vn', DEVICE_HN_SWITCH)).toEqual({
      tier: 'denied',
      matched: [],
    });
  });

  it('nhiều dòng cùng khớp: dòng RỘNG nhất đứng đầu và quyết định tầng', () => {
    const narrow = rule({ scopeType: 'device_site', scopeRef: 'site-hn', tier: 'needs_approval' });
    const wide = rule({ scopeType: 'device_type', scopeRef: 'type-switch', tier: 'whitelist' });
    const result = explainTier([narrow, wide], 'it01@pmh.com.vn', DEVICE_HN_SWITCH);
    expect(result.tier).toBe('whitelist');
    expect(result.matched).toEqual([wide, narrow]);
  });

  it('bỏ dòng của người khác và dòng không thuộc nhóm của đối tượng; so email không phân biệt hoa thường', () => {
    const mine = rule({ memberEmail: 'IT01@pmh.com.vn', tier: 'needs_approval' });
    const other = rule({ memberEmail: 'it02@pmh.com.vn' });
    const elsewhere = rule({ scopeRef: 'site-dn' });
    expect(explainTier([other, elsewhere, mine], 'it01@pmh.com.vn', DEVICE_HN_SWITCH)).toEqual({
      tier: 'needs_approval',
      matched: [mine],
    });
  });

  it('cùng kết quả với resolveTier — một luật, hai cách đọc', () => {
    const rules = [
      rule({ tier: 'needs_approval' }),
      rule({ scopeType: 'device_type', scopeRef: 'type-switch', tier: 'whitelist' }),
      rule({ memberEmail: 'khac@pmh.com.vn' }),
    ];
    for (const groups of [DEVICE_HN_SWITCH, [DEVICE_HN_SWITCH[0]], []]) {
      expect(explainTier(rules, 'it01@pmh.com.vn', groups).tier).toBe(
        resolveTier(rules, 'it01@pmh.com.vn', groups),
      );
    }
  });
});

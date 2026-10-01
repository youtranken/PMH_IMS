import { describe, expect, it } from 'vitest';
import { filterSubnetsBySite, groupSubnets, siteOptionsOf } from './subnet-groups';

const row = (cidr: string, siteCode: string | null, voided = false) => ({
  cidr,
  siteCode,
  voidedAt: voided ? '2026-01-01T00:00:00Z' : null,
});

/** Cột dải chia theo site: 30 dải của ba chi nhánh không còn là một cột dài lẫn lộn. */
describe('groupSubnets', () => {
  it('nhóm theo site (A→Z), "chưa gán site" sau cùng các site, dải đã ngừng dùng xuống đáy', () => {
    const groups = groupSubnets([
      row('10.0.3.0/24', 'HN'),
      row('10.0.1.0/24', 'HCM'),
      row('10.0.9.0/24', null),
      row('10.0.2.0/24', 'HCM'),
      row('10.0.8.0/24', 'HN', true),
    ]);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.cidr)])).toEqual([
      ['site:HCM', ['10.0.1.0/24', '10.0.2.0/24']],
      ['site:HN', ['10.0.3.0/24']],
      ['nosite', ['10.0.9.0/24']],
      ['voided', ['10.0.8.0/24']],
    ]);
  });

  it('chỉ một site (và không có gì khác): một nhóm không tên — không vẽ tiêu đề thừa', () => {
    const groups = groupSubnets([row('10.0.1.0/24', 'HCM'), row('10.0.2.0/24', 'HCM')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('all');
  });

  it('giữ thứ tự đầu vào trong từng nhóm', () => {
    const groups = groupSubnets([row('10.0.2.0/24', 'A'), row('10.0.1.0/24', 'A'), row('x', 'B')]);
    expect(groups[0].rows.map((r) => r.cidr)).toEqual(['10.0.2.0/24', '10.0.1.0/24']);
  });
});

/*
 * Q-20: bộ lọc site ở cột dải. Dải để trống site là "Tất cả site (dùng chung)" — nó phục vụ
 * MỌI site, nên lọc theo một site vẫn phải giữ nó lại.
 */
describe('filterSubnetsBySite', () => {
  const rows = [
    { cidr: 'a', siteId: 's1', siteCode: 'HCM', voidedAt: null },
    { cidr: 'b', siteId: 's2', siteCode: 'HN', voidedAt: null },
    { cidr: 'c', siteId: null, siteCode: null, voidedAt: null },
  ];
  it.each([
    ['', ['a', 'b', 'c']],
    ['s1', ['a', 'c']],
    ['s2', ['b', 'c']],
    ['khong-co', ['c']],
  ])('lọc site "%s" → %j', (siteId, expected) => {
    expect(filterSubnetsBySite(rows, siteId).map((r) => r.cidr)).toEqual(expected);
  });

  it('danh sách site để chọn: chỉ site có dải, A→Z, không lặp', () => {
    expect(siteOptionsOf([rows[1], ...rows, { ...rows[0], cidr: 'd' }])).toEqual([
      { id: 's1', code: 'HCM' },
      { id: 's2', code: 'HN' },
    ]);
  });
});

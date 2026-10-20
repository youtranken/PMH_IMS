import { describe, expect, it } from 'vitest';
import { changedGroups, FEATURE_ROWS, toggleTick } from './feature-groups-rules';

const GROUPS = [
  { id: 'g1', name: 'Mạng', features: ['overview', 'network'], memberCount: 2 },
  { id: 'g2', name: 'Tài sản', features: ['assets'], memberCount: 0 },
];

describe('Bảng nhóm quyền (Q-31)', () => {
  it('đúng bảy hàng tick theo thứ tự mockup, ba phiếu nằm dưới "Phiếu ISO"', () => {
    expect(FEATURE_ROWS.map((row) => `${row.tick}${row.indent ? ' (ISO)' : ''}`)).toEqual([
      'overview',
      'assets',
      'network',
      'iso_0203 (ISO)',
      'iso_0206 (ISO)',
      'iso_0208 (ISO)',
      'break_glass',
    ]);
  });

  it.each([
    // [draft, nhóm, ô, kết quả]
    [{}, 'g1', 'assets', { g1: ['overview', 'assets', 'network'] }],
    [{}, 'g1', 'network', { g1: ['overview'] }],
    // Tick lại đúng như ban đầu = hết thay đổi, nhóm rời khỏi bản nháp.
    [{ g1: ['overview'] }, 'g1', 'network', {}],
  ] as const)('toggleTick %j %s %s', (draft, id, tick, expected) => {
    expect(toggleTick(GROUPS, { ...draft } as Record<string, string[]>, id, tick)).toEqual(expected);
  });

  it('bỏ hết tick vẫn giữ trong nháp (nút Lưu báo lỗi, API cũng chặn)', () => {
    expect(toggleTick(GROUPS, {}, 'g2', 'assets')).toEqual({ g2: [] });
  });

  it('changedGroups: chỉ nhóm khác bản lưu, kèm cờ rỗng', () => {
    expect(changedGroups(GROUPS, { g1: ['overview'], g2: [] })).toEqual([
      { id: 'g1', name: 'Mạng', features: ['overview'], empty: false },
      { id: 'g2', name: 'Tài sản', features: [], empty: true },
    ]);
    expect(changedGroups(GROUPS, {})).toEqual([]);
  });
});

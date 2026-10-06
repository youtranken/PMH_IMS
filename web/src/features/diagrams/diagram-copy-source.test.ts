import { describe, expect, it } from 'vitest';
import type { VersionItem } from './diagram-api';
import { copySources } from './diagram-copy-source';

function v(seq: number, extra: Partial<VersionItem> = {}): VersionItem {
  return { id: `v${seq}`, seq, summary: `tóm tắt ${seq}`, label: null, savedBy: 'a@x', savedByName: 'An', savedAt: '2026-10-04T03:00:00Z', basedOnVersionId: null, restoredFromSeq: null, ...extra };
}

describe('copySources — phiên bản của bản cha để nhân bản (Q-23 05/10)', () => {
  it.each([
    ['có chính thức + nháp mới hơn: chính thức đứng đầu (mặc định), rồi bản mới nhất', { officialVersionId: 'v3', officialSeq: 3, latestVersion: { id: 'v5', seq: 5 } }, [['v3', 3, 'official'], ['v5', 5, 'latest']]],
    ['chính thức chính là bản mới nhất: chỉ một mục', { officialVersionId: 'v3', officialSeq: 3, latestVersion: { id: 'v3', seq: 3 } }, [['v3', 3, 'official']]],
    ['chưa phát hành: chỉ bản mới nhất', { officialVersionId: null, officialSeq: null, latestVersion: { id: 'v2', seq: 2 } }, [['v2', 2, 'latest']]],
    ['cha trống: không có gì', { latestVersion: null }, []],
  ])('%s', (_name, parent, want) => {
    expect(copySources(parent).map((s) => [s.id, s.seq, s.tag])).toEqual(want);
  });

  it('đã tải danh sách: thêm bản từng phát hành và bản đã đặt tên (mới trước), bỏ nháp vô danh, không trùng', () => {
    const versions = [v(6), v(5, { label: 'Trước đổi ISP' }), v(4), v(3), v(2), v(1)];
    const got = copySources({ officialVersionId: 'v3', officialSeq: 3, latestVersion: { id: 'v6', seq: 6 } }, versions, ['v1', 'v3']);
    expect(got.map((s) => [s.seq, s.tag])).toEqual([
      [3, 'official'],
      [6, 'latest'],
      [5, 'named'],
      [1, 'published'],
    ]);
    expect(got[2]).toMatchObject({ label: 'Trước đổi ISP', summary: 'tóm tắt 5', savedAt: '2026-10-04T03:00:00Z' });
    expect(got[0]).toMatchObject({ summary: 'tóm tắt 3' });
  });
});

import { describe, expect, it } from 'vitest';
import type { DiagramNode, VersionItem } from './diagram-api';
import {
  buildMap,
  canPurge,
  draftSelection,
  matchCountInside,
  nodeMatches,
  resolveSelection,
  seqRangeText,
  siblingsOf,
  tickDraft,
  tileTone,
  todoCounts,
  versionSections,
} from './diagram-map';

function node(id: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id,
    parentId: null,
    name: id,
    nodeType: 'floor',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    createdBy: 'sa@x',
    kind: 'official',
    archivedAt: null,
    status: 'official',
    latestVersion: { id: `${id}-v2`, seq: 2, savedAt: '2026-10-04T00:00:00Z', savedBy: 'sa@x', savedByName: 'SA' },
    officialVersionId: `${id}-v2`,
    officialSeq: 2,
    versionCount: 2,
    draftCount: 0,
    ...extra,
  };
}

/*
 * Toàn công ty → Tầng 1 (Lễ tân), Tầng 2 (Phòng server → Tủ R1, Tủ R2; Kế toán) ; gốc thứ hai
 * "Chi nhánh" ; một bản trình bày.
 */
const ROOT = node('root', { name: 'Toàn công ty', nodeType: 'company' });
const T1 = node('t1', { parentId: 'root', name: 'Tầng 1' });
const T2 = node('t2', { parentId: 'root', name: 'Tầng 2', status: 'official_draft', draftCount: 3 });
const LT = node('lt', { parentId: 't1', name: 'Lễ tân', driftCount: 2 });
const SV = node('sv', { parentId: 't2', name: 'Phòng server', status: 'pending', pendingApprovalId: 'a1', draftCount: 1 });
const KT = node('kt', { parentId: 't2', name: 'Kế toán', status: 'draft', officialVersionId: null, officialSeq: null, draftCount: 2 });
const R1 = node('r1', { parentId: 'sv', name: 'Tủ R1', nodeType: 'cabinet', driftCount: 1 });
const R2 = node('r2', { parentId: 'sv', name: 'Tủ R2', nodeType: 'cabinet' });
const BR = node('br', { name: 'Chi nhánh', nodeType: 'site' });
const P1 = node('p1', { kind: 'presentation', name: 'Họp BGĐ', createdBy: 'member@x', draftCount: 4 });
const ALL = [ROOT, T1, T2, LT, SV, KT, R1, R2, BR, P1];

describe('buildMap — gốc là băng, con là khu, cháu là ô', () => {
  it('không chọn gốc: mỗi gốc một băng; khu = con; ô = cháu (đếm con của ô); trình bày tách riêng', () => {
    const map = buildMap(ALL, null);
    expect(map.roots.map((r) => r.node.id)).toEqual(['root', 'br']);
    const root = map.roots[0];
    expect(root.descendants).toBe(7);
    expect(root.areas.map((a) => a.node.id)).toEqual(['t1', 't2']);
    expect(root.areas[1].tiles.map((tile) => [tile.node.id, tile.children])).toEqual([
      ['sv', 2],
      ['kt', 0],
    ]);
    expect(map.roots[1]).toMatchObject({ descendants: 0, areas: [] });
    expect(map.presentations.map((p) => p.id)).toEqual(['p1']);
    expect(map.path).toEqual([]);
  });

  it('đi sâu vào một ô: ô đó thành băng, con nó thành khu; đường dẫn từ gốc tới nó', () => {
    const map = buildMap(ALL, 'sv');
    expect(map.roots.map((r) => r.node.id)).toEqual(['sv']);
    expect(map.roots[0].areas.map((a) => [a.node.id, a.tiles.length])).toEqual([
      ['r1', 0],
      ['r2', 0],
    ]);
    expect(map.path.map((n) => n.id)).toEqual(['root', 't2', 'sv']);
  });

  it.each([
    ['id không còn trên cây', 'gone'],
    ['id của bản trình bày', 'p1'],
  ])('gốc %s → quay về bản đồ đầy đủ', (_name, rootId) => {
    expect(buildMap(ALL, rootId).roots.map((r) => r.node.id)).toEqual(['root', 'br']);
  });

  it('cha đã lưu trữ (không có trong cây) → nút đứng làm gốc, không biến mất', () => {
    const orphan = node('o', { parentId: 'archived', name: 'Mồ côi' });
    expect(buildMap([ROOT, orphan], null).roots.map((r) => r.node.id)).toEqual(['root', 'o']);
  });
});

describe('dải "Cần làm"', () => {
  it('đếm bản chính thức có nháp / chờ duyệt / lệch kho; bản trình bày không tính', () => {
    expect(todoCounts(ALL)).toEqual({ drafts: 3, pending: 1, drift: 2 });
  });

  it.each([
    ['drafts', 'kt', true],
    ['drafts', 'lt', false],
    ['pending', 'sv', true],
    ['drift', 'r1', true],
    ['drift', 'sv', false],
  ] as const)('%s khớp %s → %s', (todo, id, expected) => {
    expect(nodeMatches(ALL.find((n) => n.id === id)!, { todo, q: '' })).toBe(expected);
  });

  it('tìm theo tên không dấu, không phân biệt hoa thường; lọc rỗng = mọi nút khớp', () => {
    expect(nodeMatches(SV, { todo: null, q: 'phong SERVER' })).toBe(true);
    expect(nodeMatches(KT, { todo: null, q: 'server' })).toBe(false);
    expect(nodeMatches(KT, { todo: null, q: '' })).toBe(true);
  });

  it('số nút khớp nằm SÂU dưới một ô (không tính chính nó) — ô "▸ n bản vẽ con" báo có thứ khớp bên trong', () => {
    expect(matchCountInside(ALL, 'sv', { todo: 'drift', q: '' })).toBe(1);
    expect(matchCountInside(ALL, 't2', { todo: 'drift', q: '' })).toBe(1);
    expect(matchCountInside(ALL, 't1', { todo: 'pending', q: '' })).toBe(0);
  });
});

describe('tileTone — màu chỉ đi KÈM chữ trạng thái', () => {
  it.each([
    [{ status: 'pending' }, 'info'],
    [{ status: 'official', driftCount: 3 }, 'danger'],
    [{ status: 'pending', driftCount: 3 }, 'info'],
    [{ status: 'official_draft' }, 'warn'],
    [{ status: 'draft' }, 'warn'],
    [{ status: 'official' }, 'ok'],
    [{ status: 'empty' }, 'muted'],
  ] as const)('%j → %s', (extra, tone) => {
    expect(tileTone(node('x', extra as Partial<DiagramNode>))).toBe(tone);
  });
});

describe('siblingsOf — nút chuyển bản vẽ trong panel', () => {
  it('cùng cha; gốc thì các gốc; bản trình bày thì các bản trình bày', () => {
    expect(siblingsOf(ALL, 'kt').map((n) => n.id)).toEqual(['sv', 'kt']);
    expect(siblingsOf(ALL, 'root').map((n) => n.id)).toEqual(['root', 'br']);
    expect(siblingsOf(ALL, 'p1').map((n) => n.id)).toEqual(['p1']);
    expect(siblingsOf(ALL, 'gone')).toEqual([]);
  });
});

describe('resolveSelection', () => {
  it('id trong URL còn trên cây thì giữ; không thì gốc đầu tiên; cây chỉ có bản trình bày → bản đó', () => {
    expect(resolveSelection(ALL, 'kt')).toBe('kt');
    expect(resolveSelection(ALL, 'gone')).toBe('root');
    expect(resolveSelection([P1], null)).toBe('p1');
    expect(resolveSelection([], null)).toBeNull();
  });
});

describe('canPurge', () => {
  it.each([
    ['bản chưa phát hành, không con, SA', node('x', { officialVersionId: null, officialSeq: null, status: 'draft' }), [], 'sa', true],
    ['đã phát hành', node('x'), [], 'sa', false],
    ['còn con', node('x', { officialVersionId: null, officialSeq: null, status: 'draft' }), [node('c', { parentId: 'x' })], 'sa', false],
    ['Thành viên tạo ra nó', node('x', { officialVersionId: null, officialSeq: null, status: 'draft', createdBy: 'm@x' }), [], 'member', true],
    ['Thành viên khác', node('x', { officialVersionId: null, officialSeq: null, status: 'draft' }), [], 'member', false],
  ] as const)('%s → %s', (_name, target, others, role, expected) => {
    expect(canPurge(target, [target, ...others], { email: 'm@x', role })).toBe(expected);
  });
});

function version(seq: number, extra: Partial<VersionItem> = {}): VersionItem {
  return {
    id: `v${seq}`,
    seq,
    summary: `Lần ${seq}`,
    label: null,
    savedBy: 'an@x',
    savedByName: 'An',
    savedAt: '2026-10-04T00:00:00Z',
    basedOnVersionId: null,
    restoredFromSeq: null,
    ...extra,
  };
}

describe('versionSections — Nháp chưa phát hành / Đã phát hành', () => {
  const VERSIONS = [15, 14, 13, 12, 11, 10, 9].map((seq) => version(seq, seq === 14 ? { label: 'Mốc E2E' } : {}));

  it('chính thức #12: nháp #13–#15 (mới trước), #14 đặt tên không tick được; đã phát hành = các bản từng phát hành', () => {
    const sections = versionSections(VERSIONS, 'v12', ['v10', 'v12']);
    expect(sections.keepSeq).toBe(12);
    expect(sections.drafts.map((d) => [d.version.seq, d.checkable, d.keptBecause])).toEqual([
      [15, true, null],
      [14, false, 'named'],
      [13, true, null],
    ]);
    expect(sections.published.map((v) => v.seq)).toEqual([12, 10]);
  });

  it('chưa phát hành lần nào: mọi lần lưu là nháp, bản đầu là mốc giữ (không tick được)', () => {
    const sections = versionSections([version(3), version(2), version(1)], null, []);
    expect(sections.keepSeq).toBe(1);
    expect(sections.drafts.map((d) => [d.version.seq, d.checkable, d.keptBecause])).toEqual([
      [3, true, null],
      [2, true, null],
      [1, false, 'first'],
    ]);
    expect(sections.published).toEqual([]);
  });
});

describe('tick nháp — chọn một bản thì mọi bản MỚI hơn theo (đuôi liền)', () => {
  const sections = versionSections([15, 14, 13, 12].map((seq) => version(seq)), 'v12', ['v12']);
  const drafts = sections.drafts;

  it.each([
    ['tick #14 khi chưa chọn gì → từ #14', null, 14, true, 14],
    ['tick #13 khi đang từ #14 → từ #13', 14, 13, true, 13],
    ['bỏ tick #14 khi đang từ #13 → còn #15', 13, 14, false, 15],
    ['bỏ tick #15 (mới nhất) → không còn gì', 15, 15, false, null],
    ['bỏ tick #13 khi đang từ #13 → từ #14', 13, 13, false, 14],
  ] as const)('%s', (_name, from, seq, checked, expected) => {
    expect(tickDraft(drafts, from, seq, checked)).toBe(expected);
  });

  it('các bản đã chọn = bản tick được có số ≥ bản bắt đầu; bản đặt tên ở giữa không tính', () => {
    const named = versionSections([15, 14, 13, 12].map((seq) => version(seq, seq === 14 ? { label: 'Giữ' } : {})), 'v12', ['v12']).drafts;
    expect(draftSelection(named, 13)).toEqual([13, 15]);
    expect(draftSelection(drafts, 14)).toEqual([14, 15]);
    expect(draftSelection(drafts, null)).toEqual([]);
  });

  it('bỏ tick nhảy qua bản đặt tên tới bản tick được kế tiếp', () => {
    const named = versionSections([16, 15, 14, 13, 12].map((seq) => version(seq, seq === 14 ? { label: 'Giữ' } : {})), 'v12', ['v12']).drafts;
    expect(tickDraft(named, 13, 13, false)).toBe(15);
  });
});

describe('seqRangeText', () => {
  it.each([
    [[14, 15], '#14–#15'],
    [[13, 15], '#13, #15'],
    [[7], '#7'],
    [[], ''],
  ])('%j → %s', (seqs, text) => {
    expect(seqRangeText(seqs)).toBe(text);
  });
});

import { describe, expect, it } from 'vitest';
import { PRESENTATIONS_NODE, boardCards, boardRows, canDiscardDrafts, canPurge, expandedFor, resolveSelection } from './diagram-board';
import type { DiagramNode } from './diagram-api';

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
    status: 'draft',
    latestVersion: { id: `${id}-v2`, seq: 2, savedAt: '2026-10-04T00:00:00Z', savedBy: 'sa@x', savedByName: 'SA' },
    officialVersionId: null,
    ...extra,
  };
}

const ROOT = node('root', { name: 'Toàn công ty', nodeType: 'company' });
const T1 = node('t1', { parentId: 'root', name: 'Tầng 1' });
const T2 = node('t2', { parentId: 'root', name: 'Tầng 2' });
const R1 = node('r1', { parentId: 't2', name: 'Phòng server', status: 'official' });
const R2 = node('r2', { parentId: 't2', name: 'Phòng kế toán' });
const P1 = node('p1', { kind: 'presentation', name: 'Trình bày 1', createdBy: 'member@x' });
const ALL = [ROOT, T1, T2, R1, R2, P1];

describe('boardRows', () => {
  it('chỉ hiện con của nút đang mở; nhóm "Trình bày" đứng cuối, thu sẵn', () => {
    const rows = boardRows(ALL, new Set(['root']));
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ['root', 0],
      ['t1', 1],
      ['t2', 1],
      [PRESENTATIONS_NODE, 0],
    ]);
    expect(rows.find((r) => r.id === 't2')).toMatchObject({ hasChildren: true, expanded: false, parentId: 'root' });
  });

  it('mở nhóm "Trình bày" thì bản trình bày nằm dưới nó', () => {
    const rows = boardRows(ALL, new Set([PRESENTATIONS_NODE]));
    expect(rows.map((r) => r.id)).toEqual(['root', PRESENTATIONS_NODE, 'p1']);
    expect(rows.at(-1)?.parentId).toBe(PRESENTATIONS_NODE);
  });
});

describe('chọn nút', () => {
  it('mở sẵn đường tới nút chọn; bản trình bày thì mở nhóm', () => {
    expect([...expandedFor(ALL, 'r2', new Set())].sort()).toEqual(['root', 't2']);
    expect([...expandedFor(ALL, 'p1', new Set())]).toEqual([PRESENTATIONS_NODE]);
    expect([...expandedFor(ALL, PRESENTATIONS_NODE, new Set())]).toEqual([PRESENTATIONS_NODE]);
  });

  it('id lạ / không có → gốc đầu tiên; cây chỉ có bản trình bày → nhóm Trình bày', () => {
    expect(resolveSelection(ALL, 'khong-co')).toBe('root');
    expect(resolveSelection(ALL, null)).toBe('root');
    expect(resolveSelection(ALL, 't2')).toBe('t2');
    expect(resolveSelection([P1], null)).toBe(PRESENTATIONS_NODE);
    expect(resolveSelection([], null)).toBeNull();
  });
});

describe('boardCards', () => {
  it('thẻ "Bản vẽ này" + con trực tiếp; lọc theo trạng thái chỉ áp cho con', () => {
    expect(boardCards(ALL, 't2', 'all')).toMatchObject({ self: T2, children: [R1, R2], total: 2 });
    expect(boardCards(ALL, 't2', 'official')).toMatchObject({ self: T2, children: [R1], total: 2 });
  });

  it('nhóm Trình bày: không có thẻ "Bản vẽ này", mọi bản trình bày là thẻ', () => {
    expect(boardCards(ALL, PRESENTATIONS_NODE, 'all')).toMatchObject({ self: null, children: [P1], total: 1 });
  });
});

describe('quyền hiện nút', () => {
  const SA = { email: 'sa@x', role: 'sa' };
  const MEMBER = { email: 'member@x', role: 'member' };

  it.each([
    ['nháp sau bản chính thức', { officialVersionId: 'x-v1', officialSeq: 1 }, true],
    ['bản mới nhất là bản chính thức', { officialVersionId: 'x-v2', latestVersion: { id: 'x-v2', seq: 2, savedAt: '', savedBy: '', savedByName: null } }, false],
    ['chưa phát hành, mới một lần lưu', { latestVersion: { id: 'a', seq: 1, savedAt: '', savedBy: '', savedByName: null } }, false],
    ['chưa phát hành, nhiều lần lưu', {}, true],
    ['chưa vẽ', { latestVersion: null }, false],
  ] as const)('Bỏ bản nháp — %s', (_name, extra, expected) => {
    expect(canDiscardDrafts(node('x', extra as Partial<DiagramNode>), SA)).toBe(expected);
  });

  it('Thành viên chỉ bỏ nháp bản trình bày của mình', () => {
    expect(canDiscardDrafts(T1, MEMBER)).toBe(false);
    expect(canDiscardDrafts(P1, MEMBER)).toBe(true);
  });

  it('Xoá hẳn: chưa phát hành, không còn con; người tạo cũng được', () => {
    expect(canPurge(R2, ALL, SA)).toBe(true);
    expect(canPurge(T2, ALL, SA)).toBe(false);
    expect(canPurge(node('o', { officialVersionId: 'o-v1', officialSeq: 1 }), ALL, SA)).toBe(false);
    expect(canPurge(node('m', { createdBy: 'member@x' }), ALL, MEMBER)).toBe(true);
    expect(canPurge(R2, ALL, MEMBER)).toBe(false);
    expect(canPurge(node('w', { status: 'pending' }), ALL, SA)).toBe(false);
  });
});

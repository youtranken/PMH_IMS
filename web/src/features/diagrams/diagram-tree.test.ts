import { describe, expect, it } from 'vitest';
import { flattenTree, pathOf, subtreeIds } from './diagram-tree';

const N = (id: string, parentId: string | null, name = id) => ({ id, parentId, name });

const NODES = [N('root', null, 'Tổng công ty'), N('s1', 'root', 'Site A'), N('f1', 's1', 'Tầng 1'), N('s2', 'root', 'Site B'), N('lone', null, 'Kho')];

describe('flattenTree — cây thành danh sách thụt lề', () => {
  it('cha trước con, giữ thứ tự API trong cùng cấp, kèm độ sâu và cờ có con', () => {
    expect(flattenTree(NODES, new Set()).map((r) => [r.node.id, r.depth, r.hasChildren])).toEqual([
      ['root', 0, true],
      ['s1', 1, true],
      ['f1', 2, false],
      ['s2', 1, false],
      ['lone', 0, false],
    ]);
  });

  it('nhánh thu lại: ẩn cả cây con', () => {
    expect(flattenTree(NODES, new Set(['s1'])).map((r) => r.node.id)).toEqual(['root', 's1', 's2', 'lone']);
  });

  it('cha không còn trong danh sách (đã lưu trữ): con đứng làm gốc, không mất', () => {
    expect(flattenTree([N('x', 'gone')], new Set()).map((r) => [r.node.id, r.depth])).toEqual([['x', 0]]);
  });
});

describe('subtreeIds / pathOf', () => {
  it('cây con gồm chính nó và mọi cháu — không chuyển được bản vẽ vào đó', () => {
    expect([...subtreeIds(NODES, 's1')].sort()).toEqual(['f1', 's1']);
  });

  it('đường dẫn từ gốc tới nút', () => {
    expect(pathOf(NODES, 'f1').map((n) => n.id)).toEqual(['root', 's1', 'f1']);
  });
});


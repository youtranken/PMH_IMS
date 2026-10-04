export interface TreeNodeInput {
  id: string;
  parentId: string | null;
  name: string;
}

export interface TreeRow<T> {
  node: T;
  depth: number;
  hasChildren: boolean;
}

/** Con trực tiếp theo cha; khoá `null` = các gốc. Thứ tự giữ như danh sách vào. */
export function childrenOf<T extends TreeNodeInput>(nodes: T[]): Map<string | null, T[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string | null, T[]>();
  for (const node of nodes) {
    // Cha đã lưu trữ (không có trong danh sách) thì nút đứng làm gốc: không để nó biến mất khỏi cây.
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    out.set(key, [...(out.get(key) ?? []), node]);
  }
  return out;
}

/** Cây → danh sách thụt lề (cha trước con), bỏ cây con của các nhánh đang thu. */
export function flattenTree<T extends TreeNodeInput>(nodes: T[], collapsed: Set<string>): TreeRow<T>[] {
  const children = childrenOf(nodes);
  const rows: TreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const kids = children.get(node.id) ?? [];
      rows.push({ node, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Nút và mọi nút cháu — ô "Nằm trong" không cho chọn chúng (chuyển vào chính nhánh con). */
export function subtreeIds<T extends TreeNodeInput>(nodes: T[], id: string): Set<string> {
  const children = childrenOf(nodes);
  const out = new Set<string>();
  const walk = (at: string) => {
    if (out.has(at)) return;
    out.add(at);
    for (const child of children.get(at) ?? []) walk(child.id);
  };
  walk(id);
  return out;
}

/**
 * Thứ tự trình chiếu từ một nút: cha trước con (tổng xuống chi tiết), cùng cấp giữ thứ tự cây.
 * Chỉ bản CHÍNH THỨC đã phát hành vào trang; nút chưa phát hành vẫn đi xuống con của nó (tầng
 * chưa vẽ xong không được giấu mất các phòng bên dưới). Bản trình bày đứng ngoài cây chính thức.
 */
export function slideOrder<T extends TreeNodeInput & { officialVersionId?: string | null; kind?: string }>(nodes: T[], rootId: string): T[] {
  const official = nodes.filter((n) => n.kind !== 'presentation');
  const root = official.find((n) => n.id === rootId);
  if (!root) return [];
  const children = childrenOf(official);
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (node: T) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.officialVersionId) out.push(node);
    for (const child of children.get(node.id) ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** Các nút từ gốc tới `id` (kể cả nó) — dòng "Tổng công ty / Site A / Tầng 1". */
export function pathOf<T extends TreeNodeInput>(nodes: T[], id: string): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: T[] = [];
  const seen = new Set<string>();
  for (let at = byId.get(id); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    seen.add(at.id);
    path.unshift(at);
  }
  return path;
}

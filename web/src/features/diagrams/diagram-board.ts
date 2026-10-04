import { canManageNode } from './diagram-presentation';
import { flattenTree, type TreeRow } from './diagram-tree';
import type { DiagramNode, DiagramStatus } from './diagram-api';

/**
 * Hàm THUẦN của màn cây bản vẽ hai cột (Q-23): cây bên trái, thẻ bản vẽ bên phải. Test ở
 * `diagram-board.test.ts`. Quyền ở đây chỉ để ẨN nút — server là chốt chặn (403/409).
 */

/** Nút ảo "Trình bày (n)" của cây: bản trình bày đứng ngoài cây chính thức (Q-23). */
export const PRESENTATIONS_NODE = 'presentations';

export type StatusFilter = 'all' | DiagramStatus;
export const STATUS_FILTERS: StatusFilter[] = ['all', 'official', 'official_draft', 'draft', 'pending', 'empty'];

export interface BoardRow {
  /** `null` = dòng nhóm "Trình bày (n)". */
  node: DiagramNode | null;
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Nút cha trên cây hiển thị (để ← nhảy về cha). */
  parentId: string | null;
}

/**
 * Dòng của cây theo thứ tự hiện (cha trước con), bỏ con của nhánh đang thu. Nhóm "Trình bày"
 * đứng cuối, mặc định thu: bản trình bày là việc phụ, không chen vào cây chính thức.
 */
export function boardRows(nodes: DiagramNode[], expanded: ReadonlySet<string>): BoardRow[] {
  const official = nodes.filter((n) => n.kind !== 'presentation');
  const presentations = nodes.filter((n) => n.kind === 'presentation');
  const collapsed = new Set(official.map((n) => n.id).filter((id) => !expanded.has(id)));
  const flat: TreeRow<DiagramNode>[] = flattenTree(official, collapsed);
  const shown = new Set(flat.map((r) => r.node.id));
  const rows: BoardRow[] = flat.map(({ node, depth, hasChildren }) => ({
    node,
    id: node.id,
    depth,
    hasChildren,
    expanded: hasChildren && expanded.has(node.id),
    parentId: node.parentId && shown.has(node.parentId) ? node.parentId : null,
  }));
  if (presentations.length > 0) {
    const open = expanded.has(PRESENTATIONS_NODE);
    rows.push({ node: null, id: PRESENTATIONS_NODE, depth: 0, hasChildren: true, expanded: open, parentId: null });
    if (open) {
      for (const node of presentations) {
        rows.push({ node, id: node.id, depth: 1, hasChildren: false, expanded: false, parentId: PRESENTATIONS_NODE });
      }
    }
  }
  return rows;
}

/** Mở sẵn đường từ gốc tới nút đang chọn — vào bằng link `?node=` thì thấy ngay nó nằm đâu. */
export function expandedFor(nodes: DiagramNode[], selected: string | null, current: ReadonlySet<string>): Set<string> {
  const next = new Set(current);
  if (!selected) return next;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = byId.get(selected);
  if (selected === PRESENTATIONS_NODE || start?.kind === 'presentation') {
    next.add(PRESENTATIONS_NODE);
    return next;
  }
  const seen = new Set<string>();
  for (let at = start?.parentId ? byId.get(start.parentId) : undefined; at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
    seen.add(at.id);
    next.add(at.id);
  }
  return next;
}

/** Nút đang chọn hợp lệ: id trong URL nếu còn trên cây, không thì gốc đầu tiên. */
export function resolveSelection(nodes: DiagramNode[], wanted: string | null): string | null {
  if (wanted === PRESENTATIONS_NODE && nodes.some((n) => n.kind === 'presentation')) return PRESENTATIONS_NODE;
  if (wanted && nodes.some((n) => n.id === wanted)) return wanted;
  const official = nodes.filter((n) => n.kind !== 'presentation');
  const ids = new Set(official.map((n) => n.id));
  return official.find((n) => !n.parentId || !ids.has(n.parentId))?.id ?? (nodes.length > 0 ? PRESENTATIONS_NODE : null);
}

export interface BoardCards {
  /** Thẻ "Bản vẽ này" đứng đầu — `null` khi đang chọn nhóm "Trình bày". */
  self: DiagramNode | null;
  /** Bản vẽ con trực tiếp (hoặc mọi bản trình bày), đã lọc trạng thái. */
  children: DiagramNode[];
  /** Số con trước khi lọc — màn trống nói "không có con" khác "lọc không ra gì". */
  total: number;
}

export function boardCards(nodes: DiagramNode[], selected: string | null, filter: StatusFilter): BoardCards {
  const keep = (n: DiagramNode) => filter === 'all' || n.status === filter;
  if (selected === PRESENTATIONS_NODE) {
    const all = nodes.filter((n) => n.kind === 'presentation');
    return { self: null, children: all.filter(keep), total: all.length };
  }
  const self = nodes.find((n) => n.id === selected) ?? null;
  if (!self || self.kind === 'presentation') return { self, children: [], total: 0 };
  const all = nodes.filter((n) => n.kind !== 'presentation' && n.parentId === self.id);
  return { self, children: all.filter(keep), total: all.length };
}

/**
 * "Bỏ bản nháp" có nghĩa khi bản mới nhất KHÔNG phải bản chính thức và còn một mốc để lùi về
 * (bản chính thức, hoặc phiên bản đầu). Server mới biết chính xác bao nhiêu bản xoá được.
 */
export function canDiscardDrafts(node: DiagramNode, me: { email: string; role: string }): boolean {
  if (!canManageNode(node, me) || !node.latestVersion) return false;
  if (node.officialVersionId) return node.latestVersion.id !== node.officialVersionId;
  return node.latestVersion.seq > 1;
}

/** "Xoá hẳn": chỉ bản chưa phát hành, không còn con; Admin/SA, người tạo, hoặc chủ bản trình bày. */
export function canPurge(node: DiagramNode, nodes: DiagramNode[], me: { email: string; role: string }): boolean {
  if (node.officialVersionId || node.officialSeq || node.status === 'pending') return false;
  if (nodes.some((n) => n.parentId === node.id)) return false;
  const creator = (node.createdBy ?? '').toLowerCase() === me.email.toLowerCase();
  return creator || canManageNode(node, me);
}

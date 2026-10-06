import { foldSearch } from '@/lib/search-fold';
import { canManageNode } from './diagram-presentation';
import { childrenOf, pathOf, subtreeIds } from './diagram-tree';
import type { DiagramNode, VersionItem } from './diagram-api';

/**
 * Hàm THUẦN của màn /diagrams "bản đồ không gian" (Q-23): gốc là băng, con là khu, cháu là ô;
 * dải "Cần làm"; panel phiên bản. Test bảng dữ liệu ở `diagram-map.test.ts`. Quyền ở đây chỉ để
 * ẨN nút — server là chốt chặn (403/409).
 */

export interface MapTile {
  node: DiagramNode;
  /** Số bản vẽ con trực tiếp — ô có con thì có nút "▸ n bản vẽ con" để đi sâu. */
  children: number;
}

export interface MapArea {
  node: DiagramNode;
  tiles: MapTile[];
}

export interface MapRoot {
  node: DiagramNode;
  /** Mọi bản vẽ nằm dưới băng này (mọi tầng). */
  descendants: number;
  areas: MapArea[];
}

export interface DiagramMap {
  roots: MapRoot[];
  presentations: DiagramNode[];
  /** Đường từ gốc thật tới nút đang làm gốc bản đồ; rỗng = bản đồ đầy đủ. */
  path: DiagramNode[];
}

const officialOf = (nodes: DiagramNode[]) => nodes.filter((n) => n.kind !== 'presentation');

/**
 * Bản đồ từ một gốc. `rootId` = ô người dùng đi sâu vào (`?root=`); không còn trên cây (bị lưu
 * trữ, link cũ) hay là bản trình bày thì quay về bản đồ đầy đủ thay vì một màn trống.
 */
export function buildMap(nodes: DiagramNode[], rootId: string | null): DiagramMap {
  const official = officialOf(nodes);
  const presentations = nodes.filter((n) => n.kind === 'presentation');
  const children = childrenOf(official);
  const focus = rootId ? official.find((n) => n.id === rootId) : undefined;
  const tops = focus ? [focus] : (children.get(null) ?? []);
  const roots = tops.map((top) => ({
    node: top,
    descendants: subtreeIds(official, top.id).size - 1,
    areas: (children.get(top.id) ?? []).map((area) => ({
      node: area,
      tiles: (children.get(area.id) ?? []).map((tile) => ({ node: tile, children: (children.get(tile.id) ?? []).length })),
    })),
  }));
  return { roots, presentations, path: focus ? pathOf(official, focus.id) : [] };
}

export type TodoKind = 'drafts' | 'pending' | 'drift';
export const TODO_KINDS: TodoKind[] = ['drafts', 'pending', 'drift'];

export interface MapFilter {
  todo: TodoKind | null;
  q: string;
}

function hasTodo(node: DiagramNode, todo: TodoKind): boolean {
  if (node.kind === 'presentation') return false;
  if (todo === 'drafts') return (node.draftCount ?? 0) > 0;
  if (todo === 'pending') return node.status === 'pending' || Boolean(node.pendingApprovalId);
  return (node.driftCount ?? 0) > 0;
}

/** Số bản vẽ (chính thức) cần làm từng loại — bản trình bày là việc riêng, không vào dải. */
export function todoCounts(nodes: DiagramNode[]): Record<TodoKind, number> {
  const out: Record<TodoKind, number> = { drafts: 0, pending: 0, drift: 0 };
  for (const node of nodes) for (const todo of TODO_KINDS) if (hasTodo(node, todo)) out[todo] += 1;
  return out;
}

/** Nút khớp chip "Cần làm" đang bật VÀ ô tìm (tên, bỏ dấu). Lọc rỗng = khớp hết. */
export function nodeMatches(node: DiagramNode, filter: MapFilter): boolean {
  if (filter.todo && !hasTodo(node, filter.todo)) return false;
  const q = foldSearch(filter.q.trim());
  return !q || foldSearch(node.name).includes(q);
}

export const filterActive = (filter: MapFilter) => Boolean(filter.todo || filter.q.trim());

/** Số nút khớp nằm DƯỚI `id` (không tính nó) — ô thu gọn vẫn báo có thứ khớp bên trong. */
export function matchCountInside(nodes: DiagramNode[], id: string, filter: MapFilter): number {
  const official = officialOf(nodes);
  const inside = subtreeIds(official, id);
  inside.delete(id);
  return official.filter((n) => inside.has(n.id) && nodeMatches(n, filter)).length;
}

export type TileTone = 'ok' | 'warn' | 'info' | 'danger' | 'muted';

/**
 * Màu viền/chấm của ô. Chờ duyệt đứng trước lệch kho (việc của người duyệt đang treo), lệch kho
 * đứng trước nháp. Màu không bao giờ đứng một mình: ô luôn kèm CHỮ trạng thái.
 */
export function tileTone(node: DiagramNode): TileTone {
  if (node.status === 'pending') return 'info';
  if ((node.driftCount ?? 0) > 0) return 'danger';
  if (node.status === 'draft' || node.status === 'official_draft') return 'warn';
  if (node.status === 'official') return 'ok';
  return 'muted';
}

/** Các bản vẽ cùng khu với `id` (gồm chính nó) — dải chuyển nhanh của panel. */
export function siblingsOf(nodes: DiagramNode[], id: string): DiagramNode[] {
  const self = nodes.find((n) => n.id === id);
  if (!self) return [];
  if (self.kind === 'presentation') return nodes.filter((n) => n.kind === 'presentation');
  const official = officialOf(nodes);
  for (const group of childrenOf(official).values()) if (group.some((n) => n.id === id)) return group;
  return [self];
}

/** Nút đang chọn hợp lệ: id trong URL nếu còn trên cây, không thì gốc đầu tiên. */
export function resolveSelection(nodes: DiagramNode[], wanted: string | null): string | null {
  if (wanted && nodes.some((n) => n.id === wanted)) return wanted;
  const roots = childrenOf(officialOf(nodes)).get(null) ?? [];
  return roots[0]?.id ?? nodes[0]?.id ?? null;
}

/** "Xoá hẳn": chỉ bản chưa phát hành, không còn con; Admin/SA, người tạo, hoặc chủ bản trình bày. */
export function canPurge(node: DiagramNode, nodes: DiagramNode[], me: { email: string; role: string }): boolean {
  if (node.officialVersionId || node.officialSeq || node.status === 'pending') return false;
  if (nodes.some((n) => n.parentId === node.id)) return false;
  const creator = (node.createdBy ?? '').toLowerCase() === me.email.toLowerCase();
  return creator || canManageNode(node, me);
}

export interface DraftRow {
  version: VersionItem;
  /** Bỏ được (tick được): sau mốc giữ và chưa đặt tên. Server còn giữ thêm bản bị bản khác trỏ tới. */
  checkable: boolean;
  /** Vì sao giữ: đã đặt tên, hoặc là phiên bản đầu (mốc giữ khi chưa phát hành lần nào). */
  keptBecause: 'named' | 'first' | null;
}

export interface VersionSections {
  /** Mốc giữ: bản chính thức, hoặc phiên bản đầu khi chưa phát hành lần nào. */
  keepSeq: number | null;
  /** Lần lưu chưa phát hành sau bản chính thức, mới trước. */
  drafts: DraftRow[];
  /** Phiên bản từng phát hành, mới trước — giữ mãi. */
  published: VersionItem[];
}

/** Chia danh sách phiên bản (mới trước, như `GET /versions`) thành hai khu của panel. */
export function versionSections(versions: VersionItem[], officialVersionId: string | null, publishedIds: string[]): VersionSections {
  const published = new Set(publishedIds);
  const official = officialVersionId ? versions.find((v) => v.id === officialVersionId) : undefined;
  const seqs = versions.map((v) => v.seq);
  const keepSeq = official ? official.seq : seqs.length > 0 ? Math.min(...seqs) : null;
  const drafts = versions
    .filter((v) => !published.has(v.id) && (official ? v.seq > official.seq : true))
    .map((version) => {
      const keptBecause: DraftRow['keptBecause'] = version.seq === keepSeq ? 'first' : version.label ? 'named' : null;
      return { version, checkable: keptBecause === null, keptBecause };
    });
  return { keepSeq, drafts, published: versions.filter((v) => published.has(v.id)) };
}

/**
 * Tick một bản nháp: mọi bản MỚI hơn được tick theo, vì bỏ nháp chỉ cắt ĐUÔI (Q-23) — các lần
 * lưu sau vẽ tiếp trên nó. Trạng thái chọn vì thế chỉ là "từ bản số mấy" (`null` = không chọn).
 * Bỏ tick một bản = bỏ nó và mọi bản cũ hơn, giữ phần mới hơn.
 */
export function tickDraft(drafts: DraftRow[], from: number | null, seq: number, checked: boolean): number | null {
  if (checked) return from === null ? seq : Math.min(from, seq);
  const newer = drafts.filter((d) => d.checkable && d.version.seq > seq).map((d) => d.version.seq);
  return newer.length > 0 ? Math.min(...newer) : null;
}

/** Số các bản đang chọn (tăng dần): bản tick được có số ≥ bản bắt đầu. */
export function draftSelection(drafts: DraftRow[], from: number | null): number[] {
  if (from === null) return [];
  return drafts
    .filter((d) => d.checkable && d.version.seq >= from)
    .map((d) => d.version.seq)
    .sort((a, b) => a - b);
}

/** "#14–#15" / "#13, #15" — cùng cách viết với dải server ghi vào lịch sử. */
export function seqRangeText(seqs: number[]): string {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(i === j ? `#${sorted[i]}` : `#${sorted[i]}–#${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

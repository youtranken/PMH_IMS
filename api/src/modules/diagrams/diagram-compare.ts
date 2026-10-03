import type { CellBounds, CellIndex, CellKind, IndexedCell } from './diagram-cells';

/**
 * So sánh tô màu hai phiên bản (Q-23) — hàm THUẦN trên chỉ mục ô (AD-18), test bảng dữ liệu ở
 * `diagram-compare.spec.ts`.
 *
 * Khác `diffCellIndex` (tóm tắt một dòng, đếm theo máy/kết nối) ở chỗ đây làm việc theo Ô: trình
 * xem cần biết tô ô nào trên ảnh SVG. Hai bên dùng chung `IndexedCell.fp`, nên "ô đổi" ở đây và
 * "đổi N" trong tóm tắt cùng một định nghĩa.
 */

/** Vì sao một ô bị tô vàng. `replaced` = xoá ô rồi chèn lại đúng máy đó (id ô mới). */
export type ChangeReason = 'replaced' | 'link' | 'cable' | 'moved' | 'label' | 'other';

export interface CompareCell {
  id: string;
  kind: CellKind;
  label: string;
}

/** Ô của bản cũ không còn ở bản mới — `bounds` tuyệt đối ở bản cũ; dây không có khung (`null`). */
export interface CompareGhost extends CompareCell {
  bounds: CellBounds | null;
}

export interface CompareChanged extends CompareCell {
  reasons: ChangeReason[];
}

export interface CompareAnchor {
  id: string;
  bounds: CellBounds;
}

export interface CellCompare {
  added: CompareCell[];
  removed: CompareGhost[];
  changed: CompareChanged[];
  /**
   * Ô có khung của bản MỚI, toạ độ tuyệt đối. Ảnh SVG draw.io xuất bị dời gốc theo khung bao của
   * cả bản vẽ, nên khung đứt của ô bỏ (toạ độ mô hình) chỉ đặt đúng chỗ khi trình xem đo một ô
   * mốc trên ảnh rồi lấy độ lệch.
   */
  anchors: CompareAnchor[];
}

/** Đủ mốc để còn một ô đo được kể cả khi vài ô đầu là chữ trôi hay nhóm rỗng. */
const ANCHOR_LIMIT = 8;

function labelOf(cell: IndexedCell): string {
  return cell.ims.ims_device_code || cell.label || cell.id;
}

function brief(cell: IndexedCell): CompareCell {
  return { id: cell.id, kind: cell.kind, label: labelOf(cell) };
}

function sameBounds(a: CellBounds | undefined, b: CellBounds | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Khung tuyệt đối của mọi ô có khung: draw.io lưu toạ độ ô con TƯƠNG ĐỐI với ô cha (nhóm, khung
 * tủ, khung VLAN), nên cộng dồn tới khi gặp lớp hay ô cha không có khung.
 */
export function absoluteBounds(index: CellIndex): Map<string, CellBounds> {
  const byId = new Map(index.cells.map((c) => [c.id, c]));
  const out = new Map<string, CellBounds>();
  const resolve = (cell: IndexedCell, seen: Set<string>): CellBounds | null => {
    const known = out.get(cell.id);
    if (known) return known;
    if (!cell.bounds) return null;
    const parent = cell.parent ? byId.get(cell.parent) : undefined;
    let x = cell.bounds.x;
    let y = cell.bounds.y;
    if (parent && !seen.has(parent.id)) {
      seen.add(cell.id);
      const origin = resolve(parent, seen);
      if (origin) {
        x += origin.x;
        y += origin.y;
      }
    }
    const abs = { x, y, width: cell.bounds.width, height: cell.bounds.height };
    out.set(cell.id, abs);
    return abs;
  };
  for (const cell of index.cells) resolve(cell, new Set());
  return out;
}

function reasonsOf(old: IndexedCell, now: IndexedCell, oldAbs?: CellBounds, nowAbs?: CellBounds): ChangeReason[] {
  const reasons: ChangeReason[] = [];
  if (old.source !== now.source || old.target !== now.target || (old.ims.ims_link_id ?? '') !== (now.ims.ims_link_id ?? '')) {
    reasons.push('link');
  }
  if ((old.ims.ims_cable_type_id ?? '') !== (now.ims.ims_cable_type_id ?? '')) reasons.push('cable');
  if (!sameBounds(oldAbs ?? old.bounds, nowAbs ?? now.bounds)) reasons.push('moved');
  if (labelOf(old) !== labelOf(now)) reasons.push('label');
  if (reasons.length === 0 && old.fp !== now.fp) reasons.push('other');
  return reasons;
}

export function compareCellIndex(prev: CellIndex, next: CellIndex): CellCompare {
  const before = new Map(prev.cells.map((c) => [c.id, c]));
  const after = new Map(next.cells.map((c) => [c.id, c]));
  const prevAbs = absoluteBounds(prev);
  const nextAbs = absoluteBounds(next);

  const added: IndexedCell[] = [];
  const removed: IndexedCell[] = [];
  const changed: CompareChanged[] = [];
  for (const cell of next.cells) {
    const old = before.get(cell.id);
    if (!old || old.kind !== cell.kind) {
      added.push(cell);
      continue;
    }
    if (old.fp === cell.fp) continue;
    const reasons = reasonsOf(old, cell, prevAbs.get(old.id), nextAbs.get(cell.id));
    if (reasons.length > 0) changed.push({ ...brief(cell), reasons });
  }
  for (const cell of prev.cells) {
    const now = after.get(cell.id);
    if (!now || now.kind !== cell.kind) removed.push(cell);
  }

  /*
   * Ô thiết bị bị xoá rồi chèn lại đúng máy đó mang id ô mới. Người xem hỏi "máy này còn không,
   * có dời không", nên ghép cặp theo `ims_device_id` thành MỘT ô đổi thay vì một đỏ một xanh.
   */
  const pairedRemoved = new Set<string>();
  const stillAdded: IndexedCell[] = [];
  for (const cell of added) {
    const match = cell.kind === 'device' && cell.deviceId
      ? removed.find((r) => r.kind === 'device' && r.deviceId === cell.deviceId && !pairedRemoved.has(r.id))
      : undefined;
    if (!match) {
      stillAdded.push(cell);
      continue;
    }
    pairedRemoved.add(match.id);
    const rest = reasonsOf(match, cell, prevAbs.get(match.id), nextAbs.get(cell.id)).filter((r) => r !== 'other');
    changed.push({ ...brief(cell), reasons: ['replaced', ...rest] });
  }

  return {
    added: stillAdded.map(brief),
    removed: removed
      .filter((cell) => !pairedRemoved.has(cell.id))
      .map((cell) => ({ ...brief(cell), bounds: prevAbs.get(cell.id) ?? null })),
    changed,
    anchors: next.cells
      .filter((cell) => cell.kind !== 'edge' && nextAbs.has(cell.id))
      .slice(0, ANCHOR_LIMIT)
      .map((cell) => ({ id: cell.id, bounds: nextAbs.get(cell.id)! })),
  };
}

export function compareCounts(result: CellCompare): { added: number; removed: number; changed: number } {
  return { added: result.added.length, removed: result.removed.length, changed: result.changed.length };
}

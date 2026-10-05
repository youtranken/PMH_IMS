/**
 * Cách đọc vị trí U trong tủ — cùng chữ với nhãn ô trên bản vẽ và lời báo lệch kho của server
 * (`api/src/common/rack-units.ts`): "U5" hoặc "U5–U6". U1 ở đáy tủ; `start` là U thấp nhất.
 */
export function rackUnitLabel(start: number | null | undefined, size: number | null | undefined): string | null {
  if (start === null || start === undefined) return null;
  const units = size && size > 1 ? size : 1;
  return units === 1 ? `U${start}` : `U${start}–U${start + units - 1}`;
}

/** Máy đang chiếm chỗ trong một tủ (không tính máy đã thanh lý — đã rời tủ thật). */
export interface RackOccupant {
  id: string;
  code: string;
  start: number;
  size: number;
}

/**
 * Máy đầu tiên chồng lên dải `range` (bỏ qua chính máy đang sửa) — cùng luật `rackOverlap` của
 * server; server vẫn là trọng tài cuối, đây chỉ để báo tại ô trước khi lưu.
 */
export function rackClash(range: { start: number; size: number }, occupants: readonly RackOccupant[], selfId: string | null): RackOccupant | null {
  const top = range.start + range.size - 1;
  return occupants.find((o) => o.id !== selfId && o.start <= top && range.start <= o.start + o.size - 1) ?? null;
}

/** Tủ chưa khai chiều cao: vẽ tới chiều cao tủ phổ biến, hoặc cao hơn nếu đã có máy ở trên đó. */
const DEFAULT_RACK_U = 42;

/** Mặt đứng của tủ: U cao nhất ở trên cùng, mỗi U một dòng kèm máy đang chiếm (nếu có). */
export function rackRows(height: number | null, occupants: readonly RackOccupant[]): { u: number; occupant: RackOccupant | null }[] {
  const highest = occupants.reduce((max, o) => Math.max(max, o.start + o.size - 1), 0);
  const total = height ?? Math.max(DEFAULT_RACK_U, highest);
  return Array.from({ length: total }, (_, i) => {
    const u = total - i;
    return { u, occupant: occupants.find((o) => o.start <= u && u <= o.start + o.size - 1) ?? null };
  });
}

/** Câu dưới ô U ("Thiết bị nằm ở U30" / "Chiếm U30–U31") — trả KHOÁ i18n; thiếu / sai số thì `null`. */
export function rackPlacement(start: string, size: string): { key: string; unit: string } | null {
  const s = Number(start.trim());
  const n = Number(size.trim());
  if (!start.trim() || !size.trim() || !Number.isInteger(s) || !Number.isInteger(n) || s < 1 || n < 1) return null;
  return { key: n === 1 ? 'devices.rackAtOne' : 'devices.rackAtMany', unit: rackUnitLabel(s, n) ?? '' };
}

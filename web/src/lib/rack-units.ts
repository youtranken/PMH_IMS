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

/**
 * U bắt đầu còn trống gần `want` nhất cho một máy `size` U trong tủ cao `height` (bỏ qua chính máy
 * `selfId`); cách đều hai phía thì lấy phía dưới. `null` = không còn khe nào vừa. Server vẫn là
 * trọng tài chồng U — đây chỉ để đề xuất sẵn một U hợp lệ.
 */
export function nearestFreeU(want: number, size: number, height: number, occupants: readonly RackOccupant[], selfId: string | null): number | null {
  const highest = height - size + 1;
  if (highest < 1) return null;
  const from = Math.min(Math.max(want, 1), highest);
  const fits = (start: number) => start >= 1 && start <= highest && !rackClash({ start, size }, occupants, selfId);
  for (let d = 0; d < height; d += 1) {
    if (fits(from - d)) return from - d;
    if (fits(from + d)) return from + d;
  }
  return null;
}

/**
 * Các dải U trống liền nhau đủ chỗ cho máy `size` U, từ đáy tủ lên (Q-26): form thiết bị cho CHỌN U
 * bắt đầu thay vì gõ mò. Bỏ qua chính máy `selfId`. Server vẫn là trọng tài chồng U.
 */
export function freeRuns(height: number, occupants: readonly RackOccupant[], size: number, selfId: string | null): { start: number; end: number }[] {
  const taken = (u: number) => occupants.some((o) => o.id !== selfId && o.start <= u && u <= o.start + o.size - 1);
  const runs: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let u = 1; u <= height + 1; u += 1) {
    const free = u <= height && !taken(u);
    if (free && start === null) start = u;
    if (!free && start !== null) {
      if (u - start >= size) runs.push({ start, end: u - 1 });
      start = null;
    }
  }
  return runs;
}

/** Một khối trong khúc tủ: một máy (trọn các U của nó) hoặc một dải U trống liền nhau. */
export interface RackSlice {
  from: number;
  to: number;
  code: string | null;
  self: boolean;
}

/**
 * Khúc tủ quanh một máy — `around` U trên và dưới, U cao ở trên. Máy chiếm nhiều U gộp một khối
 * (vẽ trọn dù chìa ra ngoài khúc), U trống liền nhau gộp một dòng. Máy chưa khai U → rỗng.
 */
export function rackWindow(occupants: readonly RackOccupant[], selfId: string, height: number | null, around: number): RackSlice[] {
  const self = occupants.find((o) => o.id === selfId);
  if (!self) return [];
  const top = height ?? Math.max(DEFAULT_RACK_U, ...occupants.map((o) => o.start + o.size - 1));
  const hi = Math.min(top, self.start + self.size - 1 + around);
  const lo = Math.max(1, self.start - around);
  const out: RackSlice[] = [];
  let u = hi;
  while (u >= lo) {
    const at = occupants.find((o) => o.start <= u && u <= o.start + o.size - 1);
    if (at) {
      out.push({ from: at.start, to: at.start + at.size - 1, code: at.code, self: at.id === selfId });
      u = at.start - 1;
      continue;
    }
    let end = u;
    while (end - 1 >= lo && !occupants.some((o) => o.start <= end - 1 && end - 1 <= o.start + o.size - 1)) end -= 1;
    out.push({ from: end, to: u, code: null, self: false });
    u = end - 1;
  }
  return out;
}

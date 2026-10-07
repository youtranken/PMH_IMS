import { paintImsStyle } from '@/ui/drawio-protocol';
import { cellIdOf, cellWrapper, parseDrawioXml } from './drawio-bridge';

/**
 * Nhãn cổng ở HAI ĐẦU dây của kho (Q-23) — hàm THUẦN, test bảng ở `cable-ends.test.ts`.
 *
 * Nét mang cờ `ims_port_labels="ends"` (lưu trong XML khô) có hai ô nhãn con, id cố định theo nét
 * (`<nét>-ims-ps` ở đầu nguồn, `<nét>-ims-pt` ở đầu đích). Server dựng chúng mỗi lần mở và gỡ mỗi lần
 * lưu (`diagram-hydrate.ts`); web chỉ chèn / sửa / gỡ chúng khi CHÍNH nó đổi nét trong lúc vẽ (Khai,
 * Vẽ vào, Tự đi lại dây, bỏ kết nối), để người vẽ thấy ngay mà không phải lưu rồi mở lại.
 */

export const PORT_LABELS_ATTR = 'ims_port_labels';
export const PORT_LABELS_ENDS = 'ends';

const SUFFIX = { source: '-ims-ps', target: '-ims-pt' } as const;
/** Dấu style server đặt cho ô nhãn đầu dây (`portEndStyle` của `diagram-hydrate.ts`). */
const PORT_END_MARK = 'imsPortEnd=1';

/** Style + chỗ đặt do server dựng theo loại dây (`DiagramLink.endLabel`). */
export interface EndLabelSpec {
  style: string;
  offset: number;
}

/** Cổng ở đầu nguồn / đầu đích của nét. Nét vẽ từ máy đầu kia (`peerDeviceId`) thì đọc ngược. */
export function linkEndTexts(
  link: { deviceId: string; portLabel: string; peerDeviceId: string; peerPort: string | null },
  sourceDeviceId: string | null,
): { source: string; target: string } {
  const a = link.portLabel;
  const b = link.peerPort ?? '—';
  return sourceDeviceId === link.peerDeviceId ? { source: b, target: a } : { source: a, target: b };
}

/** Id hai ô nhãn đầu của một nét (cố định theo nét) — trình xem coi chúng là chính nét dây. */
export function portEndIds(edgeId: string): string[] {
  return [edgeId + SUFFIX.source, edgeId + SUFFIX.target];
}

/** Mọi id ô trong XML (`<mxCell>` trần và phần tử bọc) — đọc một lần cho cả lô dây. */
export function cellIdsIn(xml: string): Set<string> {
  const found = new Set<string>();
  const doc = parseDrawioXml(xml);
  if (!doc) return found;
  for (const tag of ['mxCell', 'UserObject', 'object']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const id = el.getAttribute('id');
      if (id) found.add(id);
    }
  }
  return found;
}

function geometry(x: number): string {
  return `<mxGeometry x="${x}" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>`;
}

/**
 * Mục `i` / `u` của lệnh `patch` cho hai nhãn đầu của một nét. Ô đã có thì SỬA (không gỡ rồi chèn:
 * draw.io chèn trước, gỡ sau trong cùng một lệnh — gỡ cùng id là gỡ luôn ô vừa chèn).
 */
export function portEndPatch(
  /** XML cả tệp, hoặc `cellIdsIn(xml)` đã đọc sẵn khi gọi trong vòng lặp theo dây. */
  xml: string | ReadonlySet<string>,
  edgeId: string,
  texts: { source: string; target: string },
  spec: EndLabelSpec,
  palette: Record<string, string>,
  /** Chỗ đặt đã đo từ hình (`portEndOffset`); vắng thì dùng chỗ mặc định server gửi. */
  offset: number = spec.offset,
): { i: object[]; u: Record<string, Record<string, string>> } {
  const style = paintImsStyle(spec.style, palette);
  const ids = { source: edgeId + SUFFIX.source, target: edgeId + SUFFIX.target };
  const present = typeof xml === 'string' ? cellIdsIn(xml) : xml;
  const out: { i: object[]; u: Record<string, Record<string, string>> } = { i: [], u: {} };
  for (const side of ['source', 'target'] as const) {
    const at = geometry(side === 'source' ? -offset : offset);
    if (present.has(ids[side])) {
      out.u[ids[side]] = { value: texts[side], style, geometry: at };
    } else {
      out.i.push({ id: ids[side], vertex: 1, connectable: 0, parent: edgeId, value: texts[side], style, geometry: at });
    }
  }
  return out;
}

/**
 * Nhãn đầu dây đang là con của nét — mục `r` khi nét thôi mang kết nối. Tìm theo cha + dấu style chứ
 * không chỉ theo id: nét nhân bản / dán mang theo bản sao nhãn với id mới do draw.io đặt.
 */
export function portEndRemoval(xml: string, edgeId: string): string[] {
  const doc = parseDrawioXml(xml);
  if (!doc) return [];
  const out: string[] = [];
  for (const cell of Array.from(doc.getElementsByTagName('mxCell'))) {
    if (cell.getAttribute('parent') !== edgeId) continue;
    const id = cellIdOf(cell);
    const marked = (cell.getAttribute('style') ?? '').split(';').includes(PORT_END_MARK);
    if (id && (marked || id === edgeId + SUFFIX.source || id === edgeId + SUFFIX.target)) out.push(id);
  }
  return out;
}

/*
 * Nhãn cổng SÁT đầu dây (Q-26 07/10). PHẢI cùng phép với `portEndOffset` / `edgePaths` của api
 * (`api/src/modules/diagrams/port-end-place.ts`, `diagram-cells.ts`) — nhãn chèn lúc khai dây và nhãn
 * server dựng lúc mở là một. Bảng test hai bên dùng chung dữ liệu.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgePath {
  source: Box | null;
  target: Box | null;
  points: { x: number; y: number }[];
  orthogonal: boolean;
}

const PORT_END_GAP = 22;
const PORT_END_FALLBACK = 0.75;
const MIN_OFFSET = 0.3;

const centerOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

function exitDistance(box: Box, from: { x: number; y: number }, to: { x: number; y: number }, orthogonal: boolean): number {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (orthogonal) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const ux = Math.abs(dx) / length;
  const uy = Math.abs(dy) / length;
  const along = Math.min(ux > 0 ? box.width / 2 / ux : Infinity, uy > 0 ? box.height / 2 / uy : Infinity);
  return Number.isFinite(along) ? along : 0;
}

/** Vị trí tương đối (0 … 1) của hai nhãn đầu: cách mép máy ~22px theo độ dài thật của nét. */
export function portEndOffset(path: EdgePath): number {
  if (!path.source || !path.target) return PORT_END_FALLBACK;
  const line = [centerOf(path.source), ...path.points, centerOf(path.target)];
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const dx = Math.abs(line[i].x - line[i - 1].x);
    const dy = Math.abs(line[i].y - line[i - 1].y);
    total += path.orthogonal ? dx + dy : Math.hypot(dx, dy);
  }
  const visible =
    total -
    exitDistance(path.source, line[0], line[1], path.orthogonal) -
    exitDistance(path.target, line[line.length - 1], line[line.length - 2], path.orthogonal);
  if (visible <= 0) return MIN_OFFSET;
  return Math.max(MIN_OFFSET, Math.round((1 - (2 * PORT_END_GAP) / visible) * 1000) / 1000);
}

/** Khung tuyệt đối của ô (cộng dồn toạ độ khung cha) và đường đi của nét, đọc một lần từ XML. */
export function drawingGeometry(xml: string): { boxOf: (id: string) => Box | null; edgePath: (id: string) => EdgePath | null } {
  const doc = parseDrawioXml(xml);
  const cells = new Map<string, Element>();
  if (doc) {
    for (const cell of Array.from(doc.getElementsByTagName('mxCell'))) {
      const id = cellIdOf(cell);
      if (id) cells.set(id, cell);
    }
  }
  const num = (el: Element | null | undefined, name: string) => Number(el?.getAttribute(name) ?? 0) || 0;
  const geometryOf = (cell: Element | undefined) =>
    cell ? (Array.from(cell.children).find((c) => c.tagName === 'mxGeometry' && c.getAttribute('as') === 'geometry') ?? null) : null;
  const origin = (id: string | null) => {
    const at = { x: 0, y: 0 };
    const seen = new Set<string>();
    let cell = id ? cells.get(id) : undefined;
    while (cell && !seen.has(cellIdOf(cell))) {
      seen.add(cellIdOf(cell));
      const geo = geometryOf(cell);
      if (geo && geo.getAttribute('relative') !== '1') {
        at.x += num(geo, 'x');
        at.y += num(geo, 'y');
      }
      const parent = cell.getAttribute('parent');
      cell = parent ? cells.get(parent) : undefined;
    }
    return at;
  };
  const boxOf = (id: string): Box | null => {
    const cell = cells.get(id);
    const geo = geometryOf(cell);
    if (!cell || !geo || geo.getAttribute('relative') === '1') return null;
    const base = origin(cell.getAttribute('parent'));
    return { x: base.x + num(geo, 'x'), y: base.y + num(geo, 'y'), width: num(geo, 'width'), height: num(geo, 'height') };
  };
  const edgePath = (id: string): EdgePath | null => {
    const cell = cells.get(id);
    if (!cell || cell.getAttribute('edge') !== '1') return null;
    const base = origin(cell.getAttribute('parent'));
    const array = Array.from(geometryOf(cell)?.children ?? []).find((c) => c.tagName === 'Array' && c.getAttribute('as') === 'points');
    const points = Array.from(array?.children ?? []).map((p) => ({ x: base.x + num(p, 'x'), y: base.y + num(p, 'y') }));
    const source = cell.getAttribute('source');
    const target = cell.getAttribute('target');
    return {
      source: source ? boxOf(source) : null,
      target: target ? boxOf(target) : null,
      points,
      orthogonal: /(?:^|;)edgeStyle=orthogonalEdgeStyle/.test(cell.getAttribute('style') ?? ''),
    };
  };
  return { boxOf, edgePath };
}

/**
 * Ô nét (và các ô nhãn con của nó) dựng lại từ XML TRƯỚC khi xoá — "Hủy" ở hộp xoá nét dây trả nét về
 * đúng chỗ: draw.io đã xoá nét trước khi IMS kịp hỏi. Ô nét đi lệnh trước, nhãn con đi lệnh sau (nhãn
 * cần cha có sẵn trong mô hình).
 */
export function edgeRestoreCells(xml: string, edgeIds: string[]): { edges: object[]; labels: object[] } {
  const out: { edges: object[]; labels: object[] } = { edges: [], labels: [] };
  const doc = parseDrawioXml(xml);
  if (!doc) return out;
  const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
  const all = Array.from(doc.getElementsByTagName('mxCell'));
  const geometryOf = (cell: Element) => Array.from(cell.children).find((c) => c.tagName === 'mxGeometry');
  for (const id of edgeIds) {
    const cell = all.find((c) => cellIdOf(c) === id && c.getAttribute('edge') === '1');
    if (!cell) continue;
    const parent = cell.getAttribute('parent') ?? '1';
    const siblings = all.filter((c) => c.getAttribute('parent') === parent);
    const at = siblings.indexOf(cell);
    const wrapper = cellWrapper(cell);
    const geo = geometryOf(cell);
    out.edges.push({
      id,
      edge: 1,
      parent,
      ...(at > 0 ? { previous: cellIdOf(siblings[at - 1]) } : {}),
      ...(cell.getAttribute('source') ? { source: cell.getAttribute('source') } : {}),
      ...(cell.getAttribute('target') ? { target: cell.getAttribute('target') } : {}),
      style: cell.getAttribute('style') ?? '',
      ...(geo ? { geometry: serialize(geo) } : {}),
      ...(wrapper ? { xmlValue: serialize(wrapper.cloneNode(false)) } : { value: cell.getAttribute('value') ?? '' }),
    });
    for (const child of all.filter((c) => c.getAttribute('parent') === id)) {
      const childGeo = geometryOf(child);
      out.labels.push({
        id: cellIdOf(child),
        vertex: 1,
        connectable: 0,
        parent: id,
        value: child.getAttribute('value') ?? '',
        style: child.getAttribute('style') ?? '',
        ...(childGeo ? { geometry: serialize(childGeo) } : {}),
      });
    }
  }
  return out;
}

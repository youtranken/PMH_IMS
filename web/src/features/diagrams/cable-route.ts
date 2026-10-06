import { cellIdOf, cellWrapper, parseDrawioXml } from './drawio-bridge';

/**
 * Đi dây của kho trên màn SỬA (Q-23) — hàm THUẦN, test bảng dữ liệu ở `cable-route.test.ts`.
 *
 * Dây của kho là nét vuông góc: muốn đi đường khác thì kéo điểm uốn trên CHÍNH nét, không vẽ thêm
 * nét nối (nét tự do không mang kết nối, còn đầu dây kéo ra chỗ trống làm dây báo đỏ). Giao thức
 * nhúng không báo đang chọn nét nào, nên hai việc ở đây áp cho mọi nét mang `ims_link_id` trên một
 * trang; kết quả là các mục `u` của một lệnh `patch`.
 */

const ORTHOGONAL = 'edgeStyle=orthogonalEdgeStyle';

/** Ràng buộc cạnh ra/vào người vẽ để lại — "Tự đi lại dây" bỏ để draw.io tự chọn cạnh gần nhất. */
const CONSTRAINT_KEYS = ['exitX', 'exitY', 'exitDx', 'exitDy', 'exitPerimeter', 'entryX', 'entryY', 'entryDx', 'entryDy', 'entryPerimeter'];

function withoutKeys(style: string, keys: string[]): string[] {
  return style.split(';').filter((token) => token !== '' && !keys.includes(token.split('=')[0]));
}

/** Style của nét → kiểu vuông góc (thay kiểu nét khác), giữ mọi khoá khác của người vẽ. */
export function orthogonalStyle(style: string): string {
  if (style.split(';').includes(ORTHOGONAL)) return style;
  return `${[...withoutKeys(style, ['edgeStyle']), ORTHOGONAL].join(';')};`;
}

export type CableRouteMode = 'orthogonal' | 'reroute';

export interface CableRouteUpdate {
  style: string;
  geometry?: string;
  source?: string;
  target?: string;
}

export interface CableRouteResult {
  updates: Record<string, CableRouteUpdate>;
  /** Số nét được sửa. */
  count: number;
  /** Số nét được nối lại đầu về đúng máy. */
  reattached: number;
  /** Nét lệch mà máy của kết nối không có trên trang — người vẽ phải chèn máy hoặc xoá nét. */
  stuck: string[];
}

interface PageEdge {
  id: string;
  linkId: string;
  style: string;
  source: string | null;
  target: string | null;
}

const EMPTY: CableRouteResult = { updates: {}, count: 0, reattached: 0, stuck: [] };

function readPage(xml: string, pageId: string): { edges: PageEdge[]; devices: Map<string, { deviceId: string; parent: string | null }> } | null {
  const doc = parseDrawioXml(xml);
  if (!doc) return null;
  const page = Array.from(doc.getElementsByTagName('diagram')).find((d) => d.getAttribute('id') === pageId);
  if (!page) return null;
  const edges: PageEdge[] = [];
  const devices = new Map<string, { deviceId: string; parent: string | null }>();
  for (const cell of Array.from(page.getElementsByTagName('mxCell'))) {
    const wrapper = cellWrapper(cell);
    const id = cellIdOf(cell);
    const deviceId = wrapper?.getAttribute('ims_device_id');
    if (deviceId) devices.set(id, { deviceId, parent: cell.getAttribute('parent') });
    const linkId = wrapper?.getAttribute('ims_link_id');
    if (cell.getAttribute('edge') !== '1' || !linkId) continue;
    edges.push({ id, linkId, style: cell.getAttribute('style') ?? '', source: cell.getAttribute('source') || null, target: cell.getAttribute('target') || null });
  }
  return { edges, devices };
}

/**
 * "Bẻ dây vuông góc" (`orthogonal`): đổi kiểu nét, GIỮ điểm uốn người vẽ đã kéo. "Tự đi lại dây"
 * (`reroute`): vuông góc, bỏ điểm uốn và ràng buộc cạnh ra/vào, và nối lại đầu dây lệch / thả nổi
 * về đúng hai máy của kết nối (`links`: id kết nối → hai máy) khi máy đó có trên trang. Máy có nhiều
 * ô (vd. khung mặt sau của bản vẽ cũ) thì chọn ô cùng khung với đầu đang đúng.
 */
export function cableRoutePatch(xml: string, pageId: string, links: Map<string, { a: string; b: string }>, mode: CableRouteMode): CableRouteResult {
  const page = readPage(xml, pageId);
  if (!page) return EMPTY;
  const deviceOf = (cellId: string | null) => (cellId ? (page.devices.get(cellId)?.deviceId ?? null) : null);
  const pick = (deviceId: string, near: string | null): string | null => {
    const cells = [...page.devices].filter(([, d]) => d.deviceId === deviceId);
    const parent = near ? page.devices.get(near)?.parent : undefined;
    return (cells.find(([, d]) => parent !== undefined && d.parent === parent) ?? cells[0])?.[0] ?? null;
  };
  const result: CableRouteResult = { updates: {}, count: 0, reattached: 0, stuck: [] };
  for (const edge of page.edges) {
    if (mode === 'orthogonal') {
      const style = orthogonalStyle(edge.style);
      if (style === edge.style) continue;
      result.updates[edge.id] = { style };
      result.count += 1;
      continue;
    }
    const update: CableRouteUpdate = {
      style: orthogonalStyle(`${withoutKeys(edge.style, CONSTRAINT_KEYS).join(';')};`.replace(/^;$/, '')),
      geometry: '<mxGeometry relative="1" as="geometry"/>',
    };
    const link = links.get(edge.linkId);
    if (link) {
      const ends = attach(link, edge, deviceOf, pick);
      if (ends) {
        if (ends.source !== edge.source || ends.target !== edge.target) result.reattached += 1;
        Object.assign(update, ends);
      } else {
        result.stuck.push(edge.id);
      }
    }
    result.updates[edge.id] = update;
    result.count += 1;
  }
  return result;
}

/** Hai đầu đúng của một nét: giữ đầu đã nằm trên một máy của kết nối, đầu kia về máy còn lại. */
function attach(
  link: { a: string; b: string },
  edge: PageEdge,
  deviceOf: (cellId: string | null) => string | null,
  pick: (deviceId: string, near: string | null) => string | null,
): { source: string; target: string } | null {
  const other = (deviceId: string) => (deviceId === link.a ? link.b : link.a);
  const { source: fromCell, target: toCell } = edge;
  const from = deviceOf(fromCell);
  const to = deviceOf(toCell);
  if (fromCell && toCell && from && to && from !== to && [from, to].every((d) => d === link.a || d === link.b)) {
    return { source: fromCell, target: toCell };
  }
  if (fromCell && from && (from === link.a || from === link.b)) {
    const target = pick(other(from), fromCell);
    return target ? { source: fromCell, target } : null;
  }
  if (toCell && to && (to === link.a || to === link.b)) {
    const source = pick(other(to), toCell);
    return source ? { source, target: toCell } : null;
  }
  const source = pick(link.a, null);
  const target = source ? pick(link.b, source) : null;
  return source && target ? { source, target } : null;
}

import { escapeXmlAttr } from './drawio-bridge';

/**
 * Phát hiện nét dây mới / nét đã khai vừa bị xoá trên màn SỬA (AD-18, Q-23 "vẽ là khai, có hỏi")
 * — hàm THUẦN, test bảng dữ liệu ở `cable-diff.test.ts`.
 *
 * Giao thức nhúng draw.io không báo "vừa nối dây", nên cầu nối so XML hai lần `autosave` liên
 * tiếp. Kết quả chỉ là CÂU HỎI cho người dùng: không có đường nào từ đây ghi sơ đồ cổng mà không
 * qua hộp "Khai" / "Gỡ luôn kết nối".
 */

export interface ParsedEdge {
  id: string;
  source: string | null;
  target: string | null;
  linkId: string | null;
  style: string;
  /** Thuộc tính của `UserObject` bọc nét (rỗng khi nét là `mxCell` trần). */
  attrs: Record<string, string>;
}

interface ParsedDevice {
  deviceId: string;
  code: string;
}

interface Parsed {
  devices: Map<string, ParsedDevice>;
  edges: ParsedEdge[];
}

/** Nét mới nối hai máy kho khác nhau, chưa khai — mỗi nét một câu hỏi "Khai". */
export interface NewEdge {
  id: string;
  sourceCellId: string;
  targetCellId: string;
  sourceDeviceId: string;
  sourceCode: string;
  targetDeviceId: string;
  targetCode: string;
}

function parse(xml: string): Parsed {
  const empty: Parsed = { devices: new Map(), edges: [] };
  if (!xml || !xml.trim()) return empty;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return empty;
  const devices = new Map<string, ParsedDevice>();
  const edges: ParsedEdge[] = [];
  for (const cell of Array.from(doc.getElementsByTagName('mxCell'))) {
    const wrapper = cell.parentElement && (cell.parentElement.nodeName === 'UserObject' || cell.parentElement.nodeName === 'object') ? cell.parentElement : null;
    const id = (wrapper ?? cell).getAttribute('id') ?? '';
    if (wrapper?.getAttribute('ims_device_id')) {
      devices.set(id, { deviceId: wrapper.getAttribute('ims_device_id') ?? '', code: wrapper.getAttribute('ims_device_code') ?? '' });
    }
    if (cell.getAttribute('edge') !== '1') continue;
    const attrs: Record<string, string> = {};
    if (wrapper) for (const attr of Array.from(wrapper.attributes)) if (attr.name !== 'id') attrs[attr.name] = attr.value;
    edges.push({
      id,
      source: cell.getAttribute('source') || null,
      target: cell.getAttribute('target') || null,
      linkId: wrapper?.getAttribute('ims_link_id') || null,
      style: cell.getAttribute('style') ?? '',
      attrs,
    });
  }
  return { devices, edges };
}

function asNew(edge: ParsedEdge, devices: Map<string, ParsedDevice>): NewEdge | null {
  const source = edge.source ? devices.get(edge.source) : undefined;
  const target = edge.target ? devices.get(edge.target) : undefined;
  if (!source || !target || source.deviceId === target.deviceId) return null;
  return {
    id: edge.id,
    sourceCellId: edge.source ?? '',
    targetCellId: edge.target ?? '',
    sourceDeviceId: source.deviceId,
    sourceCode: source.code,
    targetDeviceId: target.deviceId,
    targetCode: target.code,
  };
}

/**
 * Hai lần `autosave` liên tiếp → câu hỏi cần hỏi:
 * - `added`: nét nối hai máy kho khác nhau, chưa có `ims_link_id`, mà ở lượt trước chưa có (hoặc
 *   chưa nối đúng cặp máy đó) — vẽ mới, kéo đầu nét sang máy, hay bản sao vừa bị bỏ link;
 * - `removed`: `ims_link_id` có ở lượt trước mà giờ không nét nào mang;
 * - `strip`: nét mang trùng `ims_link_id` với một nét khác (nhân bản / dán) — bỏ link khỏi bản
 *   sao, để không có hai nét cùng một kết nối. Nét giữ link là nét đã mang nó từ lượt trước.
 *
 * Nét đã khai bị kéo sang máy khác không sinh câu hỏi: tự kiểm báo đỏ "hai đầu khác".
 *
 * `known` = kết nối màn đang biết (lúc mở + vừa khai / vẽ vào). Có thì thêm luật dán từ bản vẽ
 * KHÁC: nét MỚI mang một kết nối không có ở lượt trước và không nằm trong `known` cũng bị bỏ link
 * — bản sao của một dây ở bản vẽ khác không được kéo kết nối đó sang đây (Q-23 05/10).
 */
export function diffAutosave(
  prevXml: string,
  nextXml: string,
  known?: ReadonlySet<string>,
): { added: NewEdge[]; removed: { id: string; linkId: string }[]; strip: string[] } {
  const prev = parse(prevXml);
  const next = parse(nextXml);
  const prevById = new Map(prev.edges.map((e) => [e.id, e]));
  const prevLinks = new Set(prev.edges.map((e) => e.linkId).filter(Boolean));

  const strip = new Set<string>();
  const owner = new Map<string, string>();
  for (const edge of next.edges) {
    if (!edge.linkId) continue;
    if (known && !prevById.has(edge.id) && !prevLinks.has(edge.linkId) && !known.has(edge.linkId)) {
      strip.add(edge.id);
      continue;
    }
    const had = prevById.get(edge.id)?.linkId === edge.linkId;
    const current = owner.get(edge.linkId);
    if (current === undefined) owner.set(edge.linkId, edge.id);
    else if (had && prevById.get(current)?.linkId !== edge.linkId) {
      strip.add(current);
      owner.set(edge.linkId, edge.id);
    } else strip.add(edge.id);
  }

  const added: NewEdge[] = [];
  for (const edge of next.edges) {
    if (edge.linkId && !strip.has(edge.id)) continue;
    const candidate = asNew(edge, next.devices);
    if (!candidate) continue;
    const before = prevById.get(edge.id);
    const was = before && !before.linkId ? asNew(before, prev.devices) : null;
    const samePair = was && was.sourceDeviceId === candidate.sourceDeviceId && was.targetDeviceId === candidate.targetDeviceId;
    if (!samePair || strip.has(edge.id)) added.push(candidate);
  }

  const linkedNow = new Set(next.edges.map((e) => e.linkId).filter(Boolean));
  const removed: { id: string; linkId: string }[] = [];
  const reported = new Set<string>();
  for (const edge of prev.edges) {
    if (!edge.linkId || linkedNow.has(edge.linkId) || reported.has(edge.linkId)) continue;
    reported.add(edge.linkId);
    removed.push({ id: edge.id, linkId: edge.linkId });
  }
  return { added, removed, strip: [...strip] };
}

/** Mọi nét nối hai máy kho khác nhau chưa khai — nút "Dây chưa khai" trên thanh trên. */
export function undeclaredEdges(xml: string): NewEdge[] {
  const parsed = parse(xml);
  return parsed.edges.filter((e) => !e.linkId).flatMap((e) => asNew(e, parsed.devices) ?? []);
}

/**
 * Danh sách "Dây chưa khai": nét không có `ims_link_id`, cộng nét mà lúc mở server báo kết nối đã
 * gỡ / gắn sai (đỏ) và trên XML ĐANG vẽ vẫn mang đúng kết nối cũ đó. Tính lại từ XML mỗi lần —
 * không từ trạng thái lúc mở — để nét vừa khai lại (đã có `ims_link_id` mới) ra khỏi danh sách,
 * không khai trùng được lần hai.
 */
export function pendingEdges(xml: string, opened: { cellId: string; linkId: string | null; state: string }[]): NewEdge[] {
  const parsed = parse(xml);
  const stale = new Map(opened.filter((e) => e.state !== 'linked' && e.linkId).map((e) => [e.cellId, e.linkId]));
  return parsed.edges
    .filter((e) => !e.linkId || stale.get(e.id) === e.linkId)
    .flatMap((e) => asNew(e, parsed.devices) ?? []);
}


export function edgeById(xml: string, id: string): ParsedEdge | null {
  return parse(xml).edges.find((e) => e.id === id) ?? null;
}

/** Máy kho của một ô (id ô → `ims_device_id`); `null` = không phải ô thiết bị kho. */
export function deviceOfCell(xml: string, cellId: string): string | null {
  return parse(xml).devices.get(cellId)?.deviceId ?? null;
}

/** Ô đầu tiên của một máy trên bản vẽ — đầu nét khi "Vẽ vào". */
export function firstDeviceCell(xml: string, deviceId: string): string | null {
  for (const [cellId, device] of parse(xml).devices) if (device.deviceId === deviceId) return cellId;
  return null;
}

/**
 * Giá trị mới (`xmlValue` của lệnh `patch`) cho một nét: giữ thuộc tính tự do của người vẽ, đè
 * `set`, bỏ `drop` (bỏ `ims_link_id` khỏi bản sao).
 */
export function bindEdgeValue(id: string, current: Record<string, string>, set: Record<string, string>, drop: string[] = []): string {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) if (!drop.includes(k) && !(k in set)) attrs[k] = v;
  Object.assign(attrs, set);
  const text = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
    .join(' ');
  return `<UserObject ${text}${text ? ' ' : ''}id="${escapeXmlAttr(id)}"/>`;
}

/** Khoá style IMS làm chủ trên nét dây của kho — trùng `IMS_EDGE_STYLE_KEYS` của server (AD-18). */
const IMS_EDGE_KEYS = ['strokeColor', 'fontColor', 'dashed', 'html', 'imsPaint'];

/** Bỏ khoá màu/nhãn IMS khỏi style một nét, giữ phần người vẽ (đường đi, mũi tên…). */
export function styleWithoutImsEdge(style: string): string {
  const kept = style.split(';').filter((token) => token !== '' && !IMS_EDGE_KEYS.includes(token.split('=')[0]));
  return kept.length > 0 ? `${kept.join(';')};` : '';
}

import { foldSearch } from '@/lib/search-fold';

/**
 * Cầu nối IMS ↔ draw.io nhúng (bản thử sơ đồ mạng, Q-23) — toàn hàm THUẦN, kiểm bằng bảng dữ liệu.
 *
 * Giao thức: draw.io chạy ở `/drawio/` trong `<iframe sandbox>` (nguồn gốc mờ), hai bên chỉ nói
 * chuyện bằng `postMessage` chuỗi JSON (`proto=json`). draw.io gửi `event`, IMS gửi `action`.
 *
 * Chèn thiết bị dùng action `patch` (khuôn diff của draw.io: `u → trang → cells → i`), không dùng
 * `merge`: `merge` so cả tệp với bản draw.io đang giữ làm mốc rồi áp phần chênh, nên chèn một hình
 * bằng `merge` có thể xoá luôn những gì người vẽ chưa lưu.
 */

export const DRAWIO_PATH = '/drawio/';

/** Tham số chung: nhúng JSON, tiếng Việt, tắt mọi dịch vụ ngoài (chạy offline trong LAN). */
const COMMON_PARAMS: Record<string, string> = {
  embed: '1',
  proto: 'json',
  spin: '1',
  lang: 'vi',
  stealth: '1',
  offline: '1',
  configure: '1',
  gapi: '0',
  od: '0',
  db: '0',
  gh: '0',
  tr: '0',
  gl: '0',
  plugins: '0',
  pwa: '0',
};

export function drawioUrl(mode: 'edit' | 'view'): string {
  const params = new URLSearchParams(COMMON_PARAMS);
  if (mode === 'edit') {
    params.set('noExitBtn', '1');
    params.set('saveAndExit', '0');
  } else {
    params.set('chrome', '0');
  }
  return `${DRAWIO_PATH}?${params.toString()}`;
}

/**
 * Trả lời cho `event: 'configure'`. `compressXml: false` để XML lưu xuống là chữ đọc được —
 * IMS phải tìm hình thiết bị trong đó (cảnh báo lệch kho, thẻ thông tin).
 */
export const DRAWIO_CONFIG = {
  compressXml: false,
  defaultLibraries: 'general;networks',
};

export interface DrawioMessage {
  event: string;
  xml?: string;
  href?: string;
  error?: unknown;
  currentPage?: number;
  modelBounds?: Bounds;
}

/** Tin từ khung draw.io → object có `event`, hoặc `null` cho mọi thứ khác (không ném). */
export function parseDrawioMessage(data: unknown): DrawioMessage | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const msg = parsed as Record<string, unknown>;
  return typeof msg.event === 'string' ? (msg as unknown as DrawioMessage) : null;
}

/*
 * Thứ tự là luật: tên khớp nhiều mục thì mục ĐẦU thắng. "Firewall" đứng trước "router" vì loại
 * "Router/Firewall" của PMH là tường lửa biên; "server" đứng sau "nas" để "NAS server" ra NAS.
 */
const SHAPE_RULES: [RegExp, string][] = [
  [/firewall|tuong lua/, 'mxgraph.networks.firewall'],
  [/router|dinh tuyen/, 'mxgraph.networks.router'],
  [/switch|chuyen mach/, 'mxgraph.networks.switch'],
  [/access point|wi-?fi|\bap\b|diem phat/, 'mxgraph.networks.wireless_hub'],
  [/\bnas\b|storage|luu tru/, 'mxgraph.networks.nas_filer'],
  [/server|may chu/, 'mxgraph.networks.server'],
  [/\bups\b|luu dien/, 'mxgraph.networks.ups_small'],
  [/laptop|xach tay/, 'mxgraph.networks.laptop'],
  [/\bpc\b|may tram|desktop/, 'mxgraph.networks.pc'],
  [/printer|may in/, 'mxgraph.networks.printer'],
  [/camera/, 'mxgraph.networks.security_camera'],
];

/** Loại thiết bị (tên trong danh mục) → hình mạng có sẵn của draw.io; `null` = khối chữ nhật. */
export function deviceShape(typeName: string): string | null {
  const folded = foldSearch(typeName);
  return SHAPE_RULES.find(([pattern]) => pattern.test(folded))?.[1] ?? null;
}

export interface DeviceForDiagram {
  id: string;
  code: string;
  name: string;
  deviceTypeName: string;
  ip: string | null;
}

/** Một ô (cell) theo khuôn JSON mà action `patch` của draw.io nhận. */
export interface DrawioCellJson {
  id: string;
  vertex: 1;
  parent: string;
  previous?: string;
  style: string;
  geometry: string;
  xmlValue: string;
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#xa;');
}

/*
 * Không đặt màu: hình dùng màu mặc định của draw.io, nên đổi giao diện sáng/tối trong draw.io vẫn
 * đúng, và IMS không phải chép mã màu ra ngoài `tokens.css`.
 */
const LABEL_STYLE = 'html=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;';

/** Cỡ hình theo loại: switch dẹt như thiết bị rack, hình mạng vuông, khối chữ nhật rộng cho đủ mã. */
export function deviceCellSize(typeName: string): { width: number; height: number } {
  const shape = deviceShape(typeName);
  if (shape === 'mxgraph.networks.switch') return { width: 100, height: 30 };
  return shape ? { width: 60, height: 60 } : { width: 120, height: 50 };
}

export function deviceCellJson(
  device: DeviceForDiagram,
  at: { cellId: string; parent: string; previous?: string | null; x: number; y: number },
): DrawioCellJson {
  const shape = deviceShape(device.deviceTypeName);
  const { width, height } = deviceCellSize(device.deviceTypeName);
  const style = shape
    ? `shape=${shape};${LABEL_STYLE}outlineConnect=0;`
    : 'rounded=1;html=0;whiteSpace=wrap;align=center;verticalAlign=middle;';
  const ip = device.ip ?? '';
  const label = ip ? `${device.code}\n${ip}` : device.code;
  const attrs: [string, string][] = [
    ['label', label],
    ['ims_device_id', device.id],
    ['ims_device_code', device.code],
    ['ims_device_ip', ip],
    ['ims_device_type', device.deviceTypeName],
    ['id', at.cellId],
  ];
  return {
    id: at.cellId,
    vertex: 1,
    parent: at.parent,
    ...(at.previous ? { previous: at.previous } : {}),
    style,
    geometry: `<mxGeometry x="${Math.round(at.x)}" y="${Math.round(at.y)}" width="${width}" height="${height}" as="geometry"/>`,
    xmlValue: `<UserObject ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(' ')}/>`,
  };
}

export function insertPatch(pageId: string, cell: DrawioCellJson) {
  return { u: { [pageId]: { cells: { i: [cell] } } } };
}

function parseXml(xml: string): Document | null {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

export function pageIds(xml: string): string[] {
  const doc = parseXml(xml);
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('diagram')).map((d) => d.getAttribute('id') ?? '');
}

/** Ô nắm id/parent: `<mxCell>` trần, hoặc `<UserObject>`/`<object>` bọc một `<mxCell>`. */
function cellsOf(page: Element): { id: string; parent: string | null; node: Element }[] {
  return Array.from(page.getElementsByTagName('mxCell')).map((cell) => {
    const wrapper = cell.parentElement && cell.parentElement.nodeName !== 'root' ? cell.parentElement : null;
    return {
      id: (wrapper ?? cell).getAttribute('id') ?? '',
      parent: cell.getAttribute('parent'),
      node: wrapper ?? cell,
    };
  });
}

/** Lớp đầu tiên của trang (con trực tiếp của ô gốc) — chỗ draw.io đặt hình mới. */
export function layerIdOf(xml: string, pageId: string): string | null {
  const doc = parseXml(xml);
  if (!doc) return null;
  const page = Array.from(doc.getElementsByTagName('diagram')).find((d) => d.getAttribute('id') === pageId);
  if (!page) return null;
  const cells = cellsOf(page);
  const root = cells.find((c) => c.parent === null);
  return cells.find((c) => root && c.parent === root.id)?.id ?? null;
}

/**
 * Ô con CUỐI của một lớp — gửi kèm làm `previous` để hình mới nằm TRÊN cùng. Thiếu `previous`
 * thì draw.io chèn hình làm con đầu tiên, tức nằm dưới mọi hình đã vẽ.
 */
export function lastChildId(xml: string, pageId: string, parentId: string): string | null {
  const doc = parseXml(xml);
  if (!doc) return null;
  const page = Array.from(doc.getElementsByTagName('diagram')).find((d) => d.getAttribute('id') === pageId);
  if (!page) return null;
  const children = cellsOf(page).filter((c) => c.parent === parentId);
  return children.length > 0 ? children[children.length - 1].id : null;
}

export interface DeviceRef {
  cellId: string;
  deviceId: string;
  code: string;
  ip: string;
  pageId: string;
}

/** Mọi hình mang `ims_device_id` (thứ tự trong tệp); hình vẽ tự do bị bỏ qua. */
export function parseDeviceRefs(xml: string): DeviceRef[] {
  const doc = parseXml(xml);
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('diagram')).flatMap((page) =>
    cellsOf(page)
      .filter((c) => c.node.hasAttribute('ims_device_id'))
      .map((c) => ({
        cellId: c.id,
        deviceId: c.node.getAttribute('ims_device_id') ?? '',
        code: c.node.getAttribute('ims_device_code') ?? '',
        ip: c.node.getAttribute('ims_device_ip') ?? '',
        pageId: page.getAttribute('id') ?? '',
      })),
  );
}

/** Trang lưu dạng nén (base64) thì IMS không đọc được hình nào bên trong. */
export function isCompressed(xml: string): boolean {
  const doc = parseXml(xml);
  if (!doc) return false;
  return Array.from(doc.getElementsByTagName('diagram')).some(
    (d) => d.getElementsByTagName('mxGraphModel').length === 0 && (d.textContent ?? '').trim() !== '',
  );
}

export type DriftReason = 'missing' | 'retired' | 'ip_changed' | 'code_changed';

export interface DeviceLive {
  code: string;
  status: string;
  ips: string[];
}

/**
 * Lệch kho so với lúc chèn hình (Q-23: cảnh báo, không ép sửa). `live = null` = máy không còn
 * tra được. Lúc chèn chưa có IP thì máy có IP về sau không tính là lệch: bản vẽ không hứa gì về IP.
 */
export function driftReasons(ref: DeviceRef, live: DeviceLive | null): DriftReason[] {
  if (!live) return ['missing'];
  const reasons: DriftReason[] = [];
  if (live.status === 'retired') reasons.push('retired');
  if (ref.ip && !live.ips.includes(ref.ip)) reasons.push('ip_changed');
  if (ref.code && live.code !== ref.code) reasons.push('code_changed');
  return reasons;
}

/**
 * Bản đem đi XEM: mỗi hình thiết bị có `link` về `/devices/<id>` (draw.io báo `openLink` khi bấm,
 * IMS mở thẻ thông tin thay vì điều hướng), hình lệch kho có "⚠ " đầu nhãn. Link người vẽ tự gắn
 * trên hình thiết bị bị thay hẳn. Bản đã lưu không đổi.
 */
export function withViewerMarks(xml: string, origin: string, warned: Set<string>): string {
  const doc = parseXml(xml);
  if (!doc) return xml;
  for (const page of Array.from(doc.getElementsByTagName('diagram'))) {
    for (const { node } of cellsOf(page)) {
      const deviceId = node.getAttribute('ims_device_id');
      if (!deviceId) continue;
      node.setAttribute('link', `${origin}/devices/${encodeURIComponent(deviceId)}`);
      if (warned.has(deviceId)) node.setAttribute('label', `⚠ ${node.getAttribute('label') ?? ''}`);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

/** Link draw.io báo về → id thiết bị, chỉ khi đúng origin IMS và đúng đường `/devices/<id>`. */
export function deviceIdFromLink(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const match = /^\/devices\/([^/]+)$/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Chỗ đặt hình mới: bên phải khối hình đang có trên trang; trang trống thì góc trên trái. */
export function nextInsertPosition(bounds: Bounds | null): { x: number; y: number } {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: 40, y: 40 };
  return { x: bounds.x + bounds.width + 40, y: bounds.y };
}

/**
 * Khối hình sau khi thêm một hình. Cần vì `patch` không làm draw.io gửi lại `autosave` (kèm khối
 * hình mới), nên chèn liên tiếp mà chỉ trông vào tin của draw.io thì hình sau đè lên hình trước.
 */
export function growBounds(bounds: Bounds | null, rect: Bounds): Bounds {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return rect;
  const x = Math.min(bounds.x, rect.x);
  const y = Math.min(bounds.y, rect.y);
  return {
    x,
    y,
    width: Math.max(bounds.x + bounds.width, rect.x + rect.width) - x,
    height: Math.max(bounds.y + bounds.height, rect.y + rect.height) - y,
  };
}

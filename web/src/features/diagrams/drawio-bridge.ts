import { foldSearch } from '@/lib/search-fold';

/**
 * Hàm THUẦN của màn sửa sơ đồ: dựng ô thiết bị kho và chèn nó vào bản vẽ đang mở. Giao thức
 * nhúng (URL, sandbox, tin `event`/`action`) nằm ở cầu nối dùng chung `@/ui/drawio-frame`.
 *
 * Chèn thiết bị dùng lệnh `patch` (khuôn diff của draw.io: `u → trang → cells → i`), không dùng
 * `merge`: `merge` so cả tệp với bản draw.io đang giữ làm mốc rồi áp phần chênh, nên chèn một hình
 * bằng `merge` có thể xoá luôn những gì người vẽ chưa lưu.
 */

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

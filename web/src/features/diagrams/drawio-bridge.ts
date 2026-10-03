/**
 * Hàm THUẦN của màn sửa sơ đồ: dựng ô thiết bị kho và chèn nó vào bản vẽ đang mở. Giao thức
 * nhúng (URL, sandbox, tin `event`/`action`) nằm ở cầu nối dùng chung `@/ui/drawio-frame`.
 *
 * Chèn thiết bị dùng lệnh `patch` (khuôn diff của draw.io: `u → trang → cells → i`), không dùng
 * `merge`: `merge` so cả tệp với bản draw.io đang giữ làm mốc rồi áp phần chênh, nên chèn một hình
 * bằng `merge` có thể xoá luôn những gì người vẽ chưa lưu.
 *
 * Hình, nhãn và cỡ của ô do SERVER dựng (`GET /diagrams/device-info`, cùng bộ luật hydrate lúc mở
 * bản vẽ — AD-18): web không tự đoán hình theo tên loại, nên hình chèn vào và hình hiện lần mở
 * sau luôn là một.
 */

/** Một máy để chèn: id + mã (hợp đồng `ims_*`) và ô server dựng sẵn theo loại. */
export interface DeviceCellSpec {
  id: string;
  code: string;
  cell: { style: string; label: string; width: number; height: number };
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

/**
 * Ô `UserObject` mang ĐÚNG hợp đồng AD-18: `ims_device_id` + `ims_device_code`. IP, loại, vị trí
 * không ghi vào ô — chúng là nhãn hydrate từ kho mỗi lần mở, ghi vào ô là đóng băng chúng.
 */
export function deviceCellJson(
  device: DeviceCellSpec,
  at: { cellId: string; parent: string; previous?: string | null; x: number; y: number },
): DrawioCellJson {
  const attrs: [string, string][] = [
    ['label', device.cell.label],
    ['ims_device_id', device.id],
    ['ims_device_code', device.code],
    ['id', at.cellId],
  ];
  return {
    id: at.cellId,
    vertex: 1,
    parent: at.parent,
    ...(at.previous ? { previous: at.previous } : {}),
    style: device.cell.style,
    geometry: `<mxGeometry x="${Math.round(at.x)}" y="${Math.round(at.y)}" width="${device.cell.width}" height="${device.cell.height}" as="geometry"/>`,
    xmlValue: `<UserObject ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(' ')}/>`,
  };
}

export function insertPatch(pageId: string, cells: DrawioCellJson[]) {
  return { u: { [pageId]: { cells: { i: cells } } } };
}

/**
 * Xếp nhiều máy chèn một lượt thành một hàng bên phải khối hình đang có; `previous` nối chuỗi để
 * ô sau nằm trên ô trước (và trên mọi hình cũ). Trả khối hình mới để lượt chèn kế tiếp không đè.
 */
export function placeCells(
  devices: DeviceCellSpec[],
  opts: { bounds: Bounds | null; parent: string; previous: string | null; newId: () => string },
): { cells: DrawioCellJson[]; bounds: Bounds | null } {
  let bounds = opts.bounds;
  let previous = opts.previous;
  const cells: DrawioCellJson[] = [];
  for (const device of devices) {
    const at = nextInsertPosition(bounds);
    const cell = deviceCellJson(device, { cellId: opts.newId(), parent: opts.parent, previous, ...at });
    cells.push(cell);
    previous = cell.id;
    bounds = growBounds(bounds, { ...at, width: device.cell.width, height: device.cell.height });
  }
  return { cells, bounds };
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

/** Máy đã có ô trên bản vẽ (mọi trang) — hộp "Thiết bị kho" hiện "đã có" thay vì chèn lần hai. */
export function deviceIdsInXml(xml: string): Set<string> {
  const doc = parseXml(xml);
  const ids = new Set<string>();
  if (!doc) return ids;
  for (const tag of ['UserObject', 'object']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const id = el.getAttribute('ims_device_id');
      if (id) ids.add(id);
    }
  }
  return ids;
}

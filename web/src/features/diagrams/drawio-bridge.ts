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
  /** `attrs`: thuộc tính `ims_*` thêm (ảnh thật của ô mới) — server quyết, web chỉ chép vào ô. */
  cell: { style: string; label: string; width: number; height: number; attrs?: Record<string, string> };
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
  const own = new Set(['label', 'ims_device_id', 'ims_device_code', 'id']);
  const extra = Object.entries(device.cell.attrs ?? {}).filter(([k]) => !own.has(k));
  const attrs: [string, string][] = [
    ['label', device.cell.label],
    ['ims_device_id', device.id],
    ['ims_device_code', device.code],
    ...extra,
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

/** Ô chèn bằng `patch`: ô thiết bị (`DrawioCellJson`) hoặc ô dây (`edge: 1`, `source`, `target`). */
export function insertPatch(pageId: string, cells: object[]) {
  return { u: { [pageId]: { cells: { i: cells } } } };
}

/*
 * Lưới chèn máy kho. Nhãn ô (mã / IP / site · tủ · U) nằm DƯỚI hình và rộng hơn hình, mà khối hình
 * draw.io báo về không tính phần nhãn tràn — nên khoảng cách tính theo nhãn: tâm hai ô cách nhau
 * ít nhất `PITCH_X`, hàng sau chừa `ROW_GAP` cho ba dòng nhãn. Một hàng tối đa `COLUMNS` máy và
 * không vượt `ROW_LIMIT` tính từ mép trái khối hình, để chèn nhiều lần không kéo bản vẽ mãi sang phải.
 */
const PITCH_X = 180;
const ROW_GAP = 80;
const COLUMNS = 5;
const ROW_LIMIT = 900;

/**
 * Xếp các máy chèn một lượt thành lưới không chồng nhau, đặt sau khối hình đang có (bên phải nếu
 * hàng còn chỗ, không thì xuống dưới khối); `previous` nối chuỗi để ô sau nằm trên ô trước (và trên
 * mọi hình cũ). Trả khối hình mới để lượt chèn kế tiếp không đè.
 */
export function placeCells(
  devices: DeviceCellSpec[],
  opts: { bounds: Bounds | null; parent: string; previous: string | null; newId: () => string },
): { cells: DrawioCellJson[]; bounds: Bounds | null } {
  let bounds = opts.bounds;
  let previous = opts.previous;
  const cells: DrawioCellJson[] = [];
  const width = Math.max(0, ...devices.map((d) => d.cell.width));
  const height = Math.max(0, ...devices.map((d) => d.cell.height));
  const pitchX = Math.max(width + 40, PITCH_X);
  const pitchY = height + ROW_GAP;
  const columns = Math.min(COLUMNS, Math.max(1, devices.length));
  const rowWidth = (columns - 1) * pitchX + width;
  let origin = { x: 40, y: 40 };
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const right = bounds.x + bounds.width + (pitchX - width);
    origin = right + rowWidth - bounds.x <= ROW_LIMIT ? { x: right, y: bounds.y } : { x: bounds.x, y: bounds.y + bounds.height + ROW_GAP };
  }
  for (const [index, device] of devices.entries()) {
    const at = { x: origin.x + (index % columns) * pitchX, y: origin.y + Math.floor(index / columns) * pitchY };
    const cell = deviceCellJson(device, { cellId: opts.newId(), parent: opts.parent, previous, ...at });
    cells.push(cell);
    previous = cell.id;
    bounds = growBounds(bounds, { ...at, width: device.cell.width, height: device.cell.height });
  }
  return { cells, bounds };
}

/**
 * Đọc XML draw.io — chỗ DUY NHẤT mọi cầu nối của màn sơ đồ parse XML trang (AD-15). Rỗng hoặc hỏng
 * → `null`: Chrome trả nửa tài liệu dựng được trước chỗ lỗi kèm `<parsererror>`, đọc tiếp nửa đó là
 * dựng lệnh `patch` trên một bản vẽ không có thật.
 */
export function parseDrawioXml(xml: string): Document | null {
  if (!xml || !xml.trim()) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

/**
 * Phần tử bọc của một `<mxCell>`: draw.io giữ id + thuộc tính dữ liệu (`ims_*`, `label`) trên
 * `<UserObject>` / `<object>` bọc ngoài. Chỉ hai thẻ đó — phần tử khác chứa `<mxCell>` không phải ô
 * bọc và không cho ô mượn id.
 */
export function cellWrapper(cell: Element): Element | null {
  const parent = cell.parentElement;
  return parent && (parent.nodeName === 'UserObject' || parent.nodeName === 'object') ? parent : null;
}

/** id của ô: của phần tử bọc nếu có, không thì của chính `<mxCell>`. */
export function cellIdOf(cell: Element): string {
  return (cellWrapper(cell) ?? cell).getAttribute('id') ?? '';
}

/** Thuộc tính dữ liệu của phần tử bọc (trừ `id`) — giữ nguyên khi dựng lại `xmlValue`. */
export function wrapperAttrs(wrapper: Element | null): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (wrapper) for (const attr of Array.from(wrapper.attributes)) if (attr.name !== 'id') attrs[attr.name] = attr.value;
  return attrs;
}

export function pageIds(xml: string): string[] {
  const doc = parseDrawioXml(xml);
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('diagram')).map((d) => d.getAttribute('id') ?? '');
}

/** Ô nắm id/parent: `<mxCell>` trần, hoặc `<UserObject>`/`<object>` bọc một `<mxCell>`. */
function cellsOf(page: Element): { id: string; parent: string | null; node: Element }[] {
  return Array.from(page.getElementsByTagName('mxCell')).map((cell) => ({
    id: cellIdOf(cell),
    parent: cell.getAttribute('parent'),
    node: cellWrapper(cell) ?? cell,
  }));
}

/** Lớp đầu tiên của trang (con trực tiếp của ô gốc) — chỗ draw.io đặt hình mới. */
export function layerIdOf(xml: string, pageId: string): string | null {
  const doc = parseDrawioXml(xml);
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
  const doc = parseDrawioXml(xml);
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
  const doc = parseDrawioXml(xml);
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

import { bindEdgeValue } from './cable-diff';
import { cellIdOf, cellWrapper, escapeXmlAttr, parseDrawioXml, wrapperAttrs, type DrawioCellJson } from './drawio-bridge';
import { RACK_LABEL_STYLE, withLabelPlacement } from './rack-fit';

/**
 * Khung của màn SỬA (AD-18): đọc hình gắn được làm khung từ XML trình vẽ, dựng giá trị mới của
 * khung khi gắn bản vẽ con / dải IP, và biến khung tủ server dựng thành ô chèn — hàm THUẦN, test
 * bảng dữ liệu ở `frame-bridge.test.ts`.
 *
 * Giao thức nhúng không báo "đang chọn ô nào", nên người vẽ chọn khung trong hộp IMS theo nhãn,
 * đọc từ XML cả tệp (`export` xml) — id ô là thứ nối hộp với hình.
 */

export interface FrameCandidate {
  id: string;
  /** Chữ thuần người vẽ thấy trên hình (rỗng nếu hình không có chữ). */
  label: string;
  childDiagramId: string | null;
  subnetId: string | null;
  cabinetId: string | null;
  /** Thuộc tính dữ liệu hiện có (hình trần: chỉ `label`) — giữ nguyên khi gắn. */
  attrs: Record<string, string>;
}

function plain(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Mọi hình (không phải ô thiết bị, nét dây, ô gốc hay lớp) trên các trang của tệp. */
export function frameCandidates(xml: string): FrameCandidate[] {
  const doc = parseDrawioXml(xml);
  if (!doc) return [];
  const out: FrameCandidate[] = [];
  for (const cell of Array.from(doc.getElementsByTagName('mxCell'))) {
    if (cell.getAttribute('vertex') !== '1') continue;
    const wrapper = cellWrapper(cell);
    if (wrapper?.getAttribute('ims_device_id')) continue;
    const attrs = wrapper ? wrapperAttrs(wrapper) : { label: cell.getAttribute('value') ?? '' };
    out.push({
      id: cellIdOf(cell),
      label: plain(attrs.label ?? ''),
      childDiagramId: attrs.ims_child_diagram_id || null,
      subnetId: attrs.ims_subnet_id || null,
      cabinetId: attrs.ims_cabinet_id || null,
      attrs,
    });
  }
  return out;
}

/** `xmlValue` mới của khung: giữ thuộc tính cũ, đặt giá trị khác `null`, gỡ thuộc tính mang `null`. */
export function bindFrameValue(frame: FrameCandidate, set: Record<string, string | null>): string {
  const put: Record<string, string> = {};
  const drop: string[] = [];
  for (const [key, value] of Object.entries(set)) {
    if (value === null) drop.push(key);
    else put[key] = value;
  }
  return bindEdgeValue(frame.id, frame.attrs, put, drop);
}

/** Hình dạng `GET /diagrams/cabinet-frame/:id` → `layout` (bố cục ở `diagram-frames.ts` của server). */
export interface CabinetFrameLayout {
  uHeight: number;
  /** `rack` = mặt tủ (chỉ mặt trước), `unplaced` = cột "Chưa khai U". */
  frames: { key: string; label: string; style: string; attrs: Record<string, string>; x: number; y: number; width: number; height: number }[];
  /** `attrs`: `ims_photo` khi ô hiện ảnh thật của mặt đó (vắng ở dữ liệu cũ). */
  devices: { frame: string; id: string; code: string; style: string; label: string; attrs?: Record<string, string>; x: number; y: number; width: number; height: number }[];
}

function geometry(x: number, y: number, width: number, height: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `<mxGeometry x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" as="geometry"/>`;
}

/**
 * Khung tủ → ô cho MỘT lệnh `patch`: khung trên lớp đích (dời tới `x`,`y`, nối `previous` để nằm
 * trên hình cũ), máy là ô CON của khung — tự kiểm nhận máy thuộc khung tủ nào theo quan hệ cha con,
 * và kéo khung thì máy đi theo.
 */
export function cabinetFrameCells(
  layout: CabinetFrameLayout,
  at: { parent: string; previous: string | null; x: number; y: number; newId: () => string },
): DrawioCellJson[] {
  const cells: DrawioCellJson[] = [];
  const frameIds = new Map<string, string>();
  let previous = at.previous;
  for (const frame of layout.frames) {
    const id = at.newId();
    frameIds.set(frame.key, id);
    const attrs = Object.entries({ label: frame.label, ...frame.attrs })
      .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
      .join(' ');
    cells.push({
      id,
      vertex: 1,
      parent: at.parent,
      ...(previous ? { previous } : {}),
      style: frame.style,
      geometry: geometry(at.x + frame.x, at.y + frame.y, frame.width, frame.height),
      xmlValue: `<UserObject ${attrs} id="${escapeXmlAttr(id)}"/>`,
    });
    previous = id;
  }
  const lastIn = new Map<string, string>();
  for (const device of layout.devices) {
    const parent = frameIds.get(device.frame);
    if (!parent) continue;
    const id = at.newId();
    const before = lastIn.get(parent);
    const extra = Object.entries(device.attrs ?? {})
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');
    cells.push({
      id,
      vertex: 1,
      parent,
      ...(before ? { previous: before } : {}),
      style: device.style,
      geometry: geometry(device.x, device.y, device.width, device.height),
      xmlValue: `<UserObject label="${escapeXmlAttr(device.label)}" ims_device_id="${escapeXmlAttr(device.id)}" ims_device_code="${escapeXmlAttr(device.code)}"${extra} id="${escapeXmlAttr(id)}"/>`,
    });
    lastIn.set(parent, id);
  }
  return cells;
}

/**
 * "Chèn tủ mạng" khi máy của tủ ĐÃ có trên trang (Q-23): ô cũ của máy (`existing`: id máy →
 * ô) được DỜI vào mặt đầu tiên của nó thay vì chèn ô thứ hai — giữ id nên dây đã gắn vẫn nối đúng
 * máy, giữ hình người vẽ đã chọn, chỉ đổi cỡ theo U và nhãn sang phải. Mặt còn lại và máy chưa có
 * trên trang thì chèn mới như `cabinetFrameCells`. Một lệnh `patch`: `i` = ô mới, `u` = ô dời
 * (`parent` + `previous` là cách draw.io nhận "dời sang khung khác").
 */
export function cabinetFramePatch(
  layout: CabinetFrameLayout,
  at: { parent: string; previous: string | null; x: number; y: number; newId: () => string },
  existing: Map<string, { id: string; style: string }>,
): { insert: DrawioCellJson[]; update: Record<string, { parent: string; previous: string; geometry: string; style: string }>; moved: number } {
  const reused = new Set<string>();
  const kept: CabinetFrameLayout['devices'] = [];
  const moves: { device: CabinetFrameLayout['devices'][number]; cell: { id: string; style: string } }[] = [];
  for (const device of layout.devices) {
    const cell = existing.get(device.id);
    if (cell && !reused.has(device.id) && device.frame !== 'unplaced') {
      reused.add(device.id);
      moves.push({ device, cell });
    } else kept.push(device);
  }
  if (moves.length === 0) return { insert: cabinetFrameCells(layout, at), update: {}, moved: 0 };
  const frameCells = cabinetFrameCells({ ...layout, devices: [] }, at);
  const frameIds = new Map(layout.frames.map((frame, i) => [frame.key, frameCells[i].id]));
  const update: Record<string, { parent: string; previous: string; geometry: string; style: string }> = {};
  const lastIn = new Map<string, string>();
  for (const { device, cell } of moves) {
    const parent = frameIds.get(device.frame);
    if (!parent) continue;
    update[cell.id] = {
      parent,
      previous: lastIn.get(parent) ?? '',
      geometry: geometry(device.x, device.y, device.width, device.height),
      style: withLabelPlacement(cell.style, RACK_LABEL_STYLE),
    };
    lastIn.set(parent, cell.id);
  }
  const insert = [...frameCells];
  for (const device of kept) {
    const parent = frameIds.get(device.frame);
    if (!parent) continue;
    const id = at.newId();
    const before = lastIn.get(parent);
    const extra = Object.entries(device.attrs ?? {})
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');
    insert.push({
      id,
      vertex: 1,
      parent,
      ...(before ? { previous: before } : {}),
      style: device.style,
      geometry: geometry(device.x, device.y, device.width, device.height),
      xmlValue: `<UserObject label="${escapeXmlAttr(device.label)}" ims_device_id="${escapeXmlAttr(device.id)}" ims_device_code="${escapeXmlAttr(device.code)}"${extra} id="${escapeXmlAttr(id)}"/>`,
    });
    lastIn.set(parent, id);
  }
  return { insert, update, moved: moves.length };
}

/** Tủ đã có khung trên bản vẽ — hộp "Chèn tủ" báo "đã có" thay vì dựng lần hai. */
export function cabinetIdsInXml(xml: string): Set<string> {
  return new Set(frameCandidates(xml).map((f) => f.cabinetId).filter((id): id is string => Boolean(id)));
}

import { nearestFreeU, type RackOccupant } from '@/lib/rack-units';
import { bindEdgeValue } from './cable-diff';
import { cellIdOf, cellWrapper, parseDrawioXml, wrapperAttrs } from './drawio-bridge';

/**
 * Máy trong khung tủ trên màn SỬA (Q-23) — hàm THUẦN, test bảng dữ liệu ở
 * `rack-fit.test.ts`.
 *
 * Kéo một máy vào khung tủ thì `childLayout=rack` của draw.io bắt ô theo vạch U nhưng làm tròn CHIỀU
 * CAO của ô (ảnh 120px thành 8U, ảnh 60px thành 4U) — máy 1U chiếm nhiều U trên hình. Sau mỗi
 * `autosave`, màn đặt lại MỌI ô máy trong khung: cao = Số U × 1U, rộng hết lòng tủ, ảnh thật lấp đầy
 * ô, nhãn một dòng bên phải. Máy mà KHO ghi cùng tủ thì đáy ở "U bắt đầu" của kho (U1 ở đáy tủ);
 * máy tủ khác / chưa khai U thì ở U trống gần chỗ thả nhất — hai máy không bao giờ chung một U
 * trên khung. Máy tủ khác được báo để màn hỏi người vẽ có chuyển máy sang tủ đó trong kho không —
 * KHÔNG bao giờ tự đổi kho.
 */

/** Chỗ đặt nhãn máy trên mặt tủ — cùng chuỗi `RACK_LABEL_STYLE` của server (hydrate dựng lại khi mở). */
export const RACK_LABEL_STYLE = 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=14;';
const LABEL_KEYS = ['labelPosition', 'verticalLabelPosition', 'align', 'verticalAlign', 'spacingLeft'];
/** Nhãn ô thiết bị ngoài khung tủ (dưới hình) — hydrate lần mở sau đặt lại theo loại. */
const BELOW_STYLE = 'verticalLabelPosition=bottom;verticalAlign=top;';
/**
 * Cao một dòng nhãn (chữ 12px của draw.io). Tâm hai nhãn cạnh nhau gần hơn mức này thì chồng chữ:
 * nhãn sau sang làn thứ hai, lùi sang phải `LABEL_LANE` px.
 */
const LABEL_LINE = 14;
const LABEL_LANE = 170;
/** Ảnh thật (không phải biểu tượng SVG) — cùng luật `PHOTO_IMAGE_RE` của server (`diagram-hydrate.ts`). */
const PHOTO_IMAGE_RE = /(?:^|;)image=data:image\/(?!svg)/;
/** Ô đưa ra ngoài khung đặt cách mép trái khung chừng này (nhãn của ô nằm dưới hình). */
const OUTSIDE_GAP = 40;
/**
 * Khoảng giữa hai máy trong cột "Chưa khai U" khi style cột thiếu `stackSpacing` — cùng số của
 * server (`COLUMN_GAP + COLUMN_LABEL_ROOM` ở `diagram-frames.ts`); stackLayout của draw.io xếp lại.
 */
const COLUMN_SPACING = 78;
/** Số đo mặc định của hình tủ IMS dựng (`diagram-frames.ts` của server) khi style thiếu khoá. */
const DEFAULT_UNIT = 14.8;
/**
 * Khung mặt sau của bản vẽ cũ (tủ nay chỉ vẽ mặt trước): nội dung đã lưu giữ nguyên nên khung đó
 * còn, nhưng máy trong nó là bản sao của ô mặt trước — không đặt theo U, không báo lần hai. Cùng
 * chuỗi `REAR_FRAME_LABEL` của server (`diagram-frames.ts`); viết bằng mã \u để chữ giao diện
 * chỉ nằm ở `vi.ts` — đây là chữ để NHẬN RA khung cũ, không hiển thị.
 */
const REAR_FRAME = /·\s*M\u1eb7t sau\s*$/u;

export interface RackFitDevice {
  code: string;
  cabinetId: string | null;
  cabinetCode: string | null;
  u: number | null;
  uSize: number | null;
  /** Nhãn một dòng khi nằm trong khung (server dựng); vắng = không đổi nhãn. */
  rackLabel?: string | null;
  /** Nhãn ba dòng ngoài khung (ô chèn của server); vắng = không đổi nhãn. */
  freeLabel?: string | null;
  /** Cỡ ô ngoài khung (rộng chuẩn, cao theo hình — ô chèn của server). */
  freeSize?: { width: number; height: number } | null;
}

export interface RackMismatch {
  cellId: string;
  deviceId: string;
  code: string;
  /** Mã tủ kho đang ghi (`null` = chưa gắn tủ). */
  deviceCabinet: string | null;
  frameId: string;
  frameCabinetId: string;
  frameLabel: string;
  /** U bắt đầu theo chỗ thả (hàng trên cùng của ô − Số U + 1, kẹp trong tủ); `null` = ô thiếu hình học. */
  dropU: number | null;
  /** Chiều cao lòng khung tính theo U. */
  rackU: number;
  /** Số U máy chiếm trong kho (vắng = 1). */
  uSize: number;
}

export interface RackFitResult {
  /** Mục `u` của lệnh `patch` (theo id ô). */
  updates: Record<string, { geometry?: string; style?: string; xmlValue?: string }>;
  /** Máy kho ghi tủ khác khung — không đặt theo U, màn hỏi người vẽ có chuyển máy sang tủ đó không. */
  cabinetMismatch: RackMismatch[];
  /** Máy cùng tủ nhưng kho chưa khai U — ở U trống gần chỗ thả, cao theo Số U (vắng = 1U); màn hỏi khai U. */
  noU: RackMismatch[];
  /** Máy trong khung tủ mà màn chưa có thông tin kho — hỏi server rồi chạy lại. */
  unknown: string[];
}

function styleMap(style: string): Map<string, string> {
  return new Map(
    style
      .split(';')
      .filter((t) => t.includes('='))
      .map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)] as [string, string]),
  );
}

/** Style với chỗ đặt nhãn mới: bỏ mọi khoá đặt nhãn cũ rồi nối `placement`. */
export function withLabelPlacement(style: string, placement: string, drop: readonly string[] = LABEL_KEYS): string {
  const kept = style.split(';').filter((token) => token !== '' && !drop.includes(token.split('=')[0]));
  return `${kept.length > 0 ? `${kept.join(';')};` : ''}${placement}`;
}

/**
 * Style ô máy trong khung tủ: nhãn bên phải (làn `lane`), ảnh thật lấp đầy ô U (`imageAspect=0`, bỏ
 * `aspect=fixed`) — cùng luật `rackDeviceStyle` của server. Ô cao đúng n U là sự thật của tủ; ảnh
 * cắt theo mặt tủ thì không méo, ảnh cũ còn viền mà giữ tỉ lệ thì co thành vạch.
 */
export function rackCellStyle(style: string, lane = 0, labelStyle = RACK_LABEL_STYLE): string {
  const placement = lane > 0 ? labelStyle.replace(/spacingLeft=(\d+)/, (_m, n: string) => `spacingLeft=${Number(n) + lane * LABEL_LANE}`) : labelStyle;
  if (!PHOTO_IMAGE_RE.test(style)) return withLabelPlacement(style, placement);
  return withLabelPlacement(style, `imageAspect=0;${placement}`, [...LABEL_KEYS, 'imageAspect', 'aspect']);
}

/** Style ô máy ngoài khung tủ: nhãn dưới hình, ảnh thật giữ tỉ lệ (như ô chèn của server). */
function freeCellStyle(style: string): string {
  if (!PHOTO_IMAGE_RE.test(style)) return withLabelPlacement(style, BELOW_STYLE);
  return withLabelPlacement(style, `imageAspect=1;aspect=fixed;${BELOW_STYLE}`, [...LABEL_KEYS, 'imageAspect', 'aspect']);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

interface Cell {
  id: string;
  parent: string | null;
  style: string;
  deviceId: string | null;
  cabinetId: string | null;
  label: string;
  /** Thuộc tính của `UserObject` bọc (trừ `id`) — giữ nguyên khi đổi nhãn bằng `xmlValue`. */
  attrs: Record<string, string>;
  geo: { x: number; y: number; width: number; height: number } | null;
  geometryXml: string | null;
}

function readCells(xml: string): Cell[] {
  const doc = parseDrawioXml(xml);
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName('mxCell')).map((cell) => {
    const wrapper = cellWrapper(cell);
    const g = Array.from(cell.children).find((c) => c.tagName === 'mxGeometry');
    const num = (name: string) => Number(g?.getAttribute(name) ?? 0) || 0;
    return {
      id: cellIdOf(cell),
      attrs: wrapperAttrs(wrapper),
      parent: cell.getAttribute('parent'),
      style: cell.getAttribute('style') ?? '',
      deviceId: wrapper?.getAttribute('ims_device_id') || null,
      cabinetId: wrapper?.getAttribute('ims_cabinet_id') || null,
      label: wrapper?.getAttribute('label') ?? cell.getAttribute('value') ?? '',
      geo: g ? { x: num('x'), y: num('y'), width: num('width'), height: num('height') } : null,
      geometryXml: g ? new XMLSerializer().serializeToString(g).replace(/\s+xmlns="[^"]*"/, '') : null,
    };
  });
}

/** Vị trí + bề rộng của ô `id` (x/y vắng = 0); `null` = không có ô, không có hình học, XML hỏng. */
export function cellBox(xml: string, id: string): { x: number; y: number; width: number } | null {
  const geo = readCells(xml).find((c) => c.id === id)?.geo;
  return geo ? { x: geo.x, y: geo.y, width: geo.width } : null;
}

/**
 * Chỗ của một ô trong XML (cha, ô đứng ngay trước trong cùng cha, hình học nguyên chuỗi) — đủ để
 * một lệnh `patch` đưa ô về đúng chỗ đó (`parent` + `previous` là cách draw.io dời ô giữa các cha).
 */
export function cellPlacement(xml: string, cellId: string): { parent: string; previous: string; geometry: string } | null {
  const cells = readCells(xml);
  const cell = cells.find((c) => c.id === cellId);
  if (!cell || !cell.parent || !cell.geometryXml) return null;
  const siblings = cells.filter((c) => c.parent === cell.parent);
  const at = siblings.indexOf(cell);
  return { parent: cell.parent, previous: at > 0 ? siblings[at - 1].id : '', geometry: cell.geometryXml };
}

function frameMetrics(frame: Cell & { geo: NonNullable<Cell['geo']> }) {
  const s = styleMap(frame.style);
  const unit = Number(s.get('rackUnitSize')) || DEFAULT_UNIT;
  const left = Number(s.get('marginLeft')) || 0;
  const right = Number(s.get('marginRight')) || 0;
  const top = Number(s.get('marginTop')) || 0;
  const bottom = Number(s.get('marginBottom')) || 0;
  return { unit, left, right, top, height: Math.round((frame.geo.height - top - bottom) / unit) };
}

/** Nhãn mới (qua `xmlValue`) khi khác nhãn đang có; vắng `label` = không đổi. */
function labelValue(cell: Cell, label: string | null | undefined): string | undefined {
  if (!label || label === cell.label || Object.keys(cell.attrs).length === 0) return undefined;
  return bindEdgeValue(cell.id, cell.attrs, { label });
}

const geometryXml = (g: { x: number; y: number; width: number; height: number }) =>
  `<mxGeometry x="${r1(g.x)}" y="${r1(g.y)}" width="${r1(g.width)}" height="${r1(g.height)}" as="geometry"/>`;

/**
 * Ô cần sửa của MỘT lượt XML trình vẽ (mô hình trần của `autosave` hay cả tệp đều đọc được).
 * `devices`: thông tin kho theo id máy. Ô đã đúng không sinh mục nào — gọi lại nhiều lần vẫn đứng yên.
 */
export function rackFit(xml: string, devices: Map<string, RackFitDevice>): RackFitResult {
  const result: RackFitResult = { updates: {}, cabinetMismatch: [], noU: [], unknown: [] };
  const cells = readCells(xml);
  // Mọi hình rack (kể cả tủ người vẽ lấy từ thư viện) đặt nhãn bên phải — cùng luật hydrate; chỉ
  // khung gắn tủ kho (`ims_cabinet_id`) mới đặt máy theo U.
  const anyRack = new Set(cells.filter((c) => /(?:^|;)childLayout=rack(?:;|$)/.test(c.style)).map((c) => c.id));
  const racks = new Map<string, Cell & { geo: NonNullable<Cell['geo']> }>();
  for (const c of cells) if (c.cabinetId && c.geo && anyRack.has(c.id)) racks.set(c.id, { ...c, geo: c.geo });
  const rear = new Set([...racks.values()].filter((f) => REAR_FRAME.test(f.label)).map((f) => f.id));
  const update = (cell: Cell, part: { geometry?: string; style?: string; xmlValue?: string }) => {
    const clean = Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length > 0) result.updates[cell.id] = { ...result.updates[cell.id], ...clean };
  };
  /** Ô máy đã biết chỗ trong từng khung: theo khung → danh sách (ô, U bắt đầu, Số U). */
  type Slot = { cell: Cell; deviceId: string; start: number | null; size: number; flexible: boolean; info: RackFitDevice };
  const placed = new Map<string, { frame: Cell & { geo: NonNullable<Cell['geo']> }; slots: Slot[] }>();
  for (const cell of cells) {
    if (!cell.deviceId) continue;
    const frame = cell.parent ? racks.get(cell.parent) : undefined;
    if (!frame) {
      // Kéo ra khỏi khung tủ: nhãn bên phải (và ảnh kéo giãn) không còn đúng chỗ.
      const outside = !cell.parent || !anyRack.has(cell.parent);
      if (outside && styleMap(cell.style).get('labelPosition') === 'right') {
        update(cell, { style: freeCellStyle(cell.style), xmlValue: labelValue(cell, devices.get(cell.deviceId)?.freeLabel) });
      } else if (!outside) {
        // Tủ người vẽ lấy từ thư viện: nhãn một dòng như hydrate, không đặt theo U.
        update(cell, { xmlValue: labelValue(cell, devices.get(cell.deviceId)?.rackLabel) });
      }
      continue;
    }
    if (rear.has(frame.id)) continue;
    const info = devices.get(cell.deviceId);
    if (!info) {
      if (!result.unknown.includes(cell.deviceId)) result.unknown.push(cell.deviceId);
      continue;
    }
    const { height } = frameMetrics(frame);
    const size = info.uSize && info.uSize > 0 ? info.uSize : 1;
    const fixed = info.cabinetId === frame.cabinetId && info.u !== null && info.u >= 1 && info.u + size - 1 <= height;
    const entry = placed.get(frame.id) ?? { frame, slots: [] };
    entry.slots.push({ cell, deviceId: cell.deviceId, start: fixed ? info.u : null, size, flexible: !fixed, info });
    placed.set(frame.id, entry);
  }

  for (const { frame, slots: list } of placed.values()) {
    const { unit, left, right, top, height } = frameMetrics(frame);
    const occupants: RackOccupant[] = list.flatMap((p) => (!p.flexible && p.start !== null ? [{ id: p.cell.id, code: p.info.code, start: p.start, size: p.size }] : []));
    // Máy theo U kho đứng yên; máy còn lại lấy U trống gần chỗ thả nhất, lần lượt từ trên xuống.
    const flexible = list.filter((p) => p.flexible).sort((a, b) => (a.cell.geo?.y ?? 0) - (b.cell.geo?.y ?? 0));
    for (const p of flexible) {
      const topU = p.cell.geo ? height - Math.max(0, Math.round((p.cell.geo.y - top) / unit)) : null;
      const drop = topU === null ? null : Math.min(Math.max(topU - p.size + 1, 1), Math.max(height - p.size + 1, 1));
      const start = drop === null ? null : (nearestFreeU(drop, p.size, height, occupants, p.cell.id) ?? drop);
      p.start = start;
      if (start !== null) occupants.push({ id: p.cell.id, code: p.info.code, start, size: p.size });
      const item: RackMismatch = {
        cellId: p.cell.id,
        deviceId: p.deviceId,
        code: p.info.code,
        deviceCabinet: p.info.cabinetCode,
        frameId: frame.id,
        frameCabinetId: frame.cabinetId ?? '',
        frameLabel: frame.label,
        dropU: start,
        rackU: height,
        uSize: p.size,
      };
      if (p.info.cabinetId !== frame.cabinetId) result.cabinetMismatch.push(item);
      else if (p.info.u === null) result.noU.push(item);
    }
    // Làn nhãn: tâm nhãn quá gần nhãn ngay trên nó (cùng làn) thì sang làn kia.
    const byCenter = list.flatMap((p) => (p.start === null ? [] : [{ p, y: top + (height - (p.start + p.size - 1)) * unit }])).sort((a, b) => a.y - b.y);
    let previous: { center: number; lane: number } | null = null;
    for (const { p, y } of byCenter) {
      const h = p.size * unit;
      const center = y + h / 2;
      const lane = previous && center - previous.center < LABEL_LINE ? 1 - previous.lane : 0;
      previous = { center, lane };
      const place = { x: left, y, width: fg(frame.geo.width - left - right), height: fg(h) };
      const g = p.cell.geo;
      const moved = !g || !near(g.x, place.x) || !near(g.y, place.y) || !near(g.width, place.width) || !near(g.height, place.height);
      const style = rackCellStyle(p.cell.style, lane);
      update(p.cell, {
        geometry: moved ? geometryXml(place) : undefined,
        style: style !== p.cell.style ? style : undefined,
        xmlValue: labelValue(p.cell, p.info.rackLabel),
      });
    }
  }
  return result;
}

const fg = (n: number) => r1(n);

/** Đọc khung tủ chứa ô `cellId` (khung IMS hoặc rack thư viện); `null` = ô không nằm trong khung. */
function frameOf(cells: Cell[], cellId: string): { cell: Cell; frame: Cell & { geo: NonNullable<Cell['geo']> } } | null {
  const cell = cells.find((c) => c.id === cellId);
  const frame = cell?.parent ? cells.find((c) => c.id === cell.parent) : undefined;
  if (!cell || !frame || !frame.geo || !/(?:^|;)childLayout=rack(?:;|$)/.test(frame.style)) return null;
  return { cell, frame: { ...frame, geo: frame.geo } };
}

export interface CellMove {
  parent: string;
  previous: string;
  geometry: string;
  style: string;
  xmlValue?: string;
}

/**
 * Hủy "Chuyển máy sang tủ này" (Q-23 mục C): đưa ô RA khỏi khung tủ, sang cạnh trái khung (cùng
 * cha với khung), cỡ trang tự do, nhãn ba dòng dưới hình. Một máy tủ khác nằm trong khung mà không
 * theo U là hình tủ sai — kể cả khi "chỗ cũ" của nó vốn đã ở trong khung.
 */
export function outsidePlacement(xml: string, cellId: string, info: RackFitDevice | undefined): CellMove | null {
  const cells = readCells(xml);
  const found = frameOf(cells, cellId);
  if (!found) return null;
  const { cell, frame } = found;
  const size = info?.freeSize ?? { width: cell.geo?.width ?? 60, height: cell.geo?.height ?? 60 };
  const siblings = cells.filter((c) => c.parent === frame.parent);
  const at = siblings.findIndex((c) => c.id === frame.id);
  return {
    parent: frame.parent ?? '1',
    previous: siblings[at]?.id ?? '',
    geometry: geometryXml({ x: frame.geo.x - OUTSIDE_GAP - size.width, y: frame.geo.y + (cell.geo?.y ?? 0), width: size.width, height: size.height }),
    style: freeCellStyle(cell.style),
    xmlValue: labelValue(cell, info?.freeLabel),
  };
}

/**
 * Hủy hộp chọn U của máy chưa khai U (Q-23 mục D): ô vào cuối cột "Chưa khai U" của cùng tủ.
 * `null` = trang chưa có cột của tủ đó (nơi gọi dựng cột rồi gọi lại).
 */
export function columnPlacement(xml: string, cellId: string, cabinetId: string, info: RackFitDevice | undefined): CellMove | null {
  const cells = readCells(xml);
  const cell = cells.find((c) => c.id === cellId);
  const column = cells.find((c) => c.cabinetId === cabinetId && /(?:^|;)childLayout=stackLayout(?:;|$)/.test(c.style));
  if (!cell || !column) return null;
  const s = styleMap(column.style);
  const children = cells.filter((c) => c.parent === column.id && c.id !== cellId);
  const last = children[children.length - 1];
  const spacing = Number(s.get('stackSpacing')) || COLUMN_SPACING;
  const firstY = (Number(s.get('startSize')) || 0) + (Number(s.get('marginTop')) || 0);
  const size = info?.freeSize ?? { width: cell.geo?.width ?? 60, height: cell.geo?.height ?? 60 };
  return {
    parent: column.id,
    previous: last?.id ?? '',
    geometry: geometryXml({
      x: Number(s.get('marginLeft')) || 0,
      y: last?.geo ? last.geo.y + last.geo.height + spacing : firstY,
      width: size.width,
      height: size.height,
    }),
    style: freeCellStyle(cell.style),
    xmlValue: labelValue(cell, info?.freeLabel),
  };
}

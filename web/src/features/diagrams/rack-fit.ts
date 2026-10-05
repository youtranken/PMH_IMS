/**
 * Máy trong khung tủ trên màn SỬA (Q-23 05/10) — hàm THUẦN, test bảng dữ liệu ở `rack-fit.test.ts`.
 *
 * Kéo một máy vào khung tủ thì `childLayout=rack` của draw.io bắt ô theo vạch U nhưng làm tròn CHIỀU
 * CAO của ô (ảnh 120px thành 8U, ảnh 60px thành 4U) — máy 1U chiếm nhiều U trên hình. Sau mỗi
 * `autosave`, màn đặt lại ô: cao = Số U × 1U, đáy ở "U bắt đầu" trong kho (U1 ở đáy tủ), rộng hết
 * lòng tủ, nhãn bên phải. Chỉ máy mà KHO ghi cùng tủ với khung; máy tủ khác thì báo, không đặt
 * theo U và không bao giờ đổi tủ trong kho.
 */

/** Chỗ đặt nhãn máy trên mặt tủ — cùng chuỗi `RACK_LABEL_STYLE` của server (hydrate dựng lại khi mở). */
export const RACK_LABEL_STYLE = 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=14;';
const LABEL_KEYS = ['labelPosition', 'verticalLabelPosition', 'align', 'verticalAlign', 'spacingLeft'];
/** Nhãn ô thiết bị ngoài khung tủ (dưới hình) — hydrate lần mở sau đặt lại theo loại. */
const BELOW_STYLE = 'verticalLabelPosition=bottom;verticalAlign=top;';
/** Số đo mặc định của hình tủ IMS dựng (`diagram-frames.ts` của server) khi style thiếu khoá. */
const DEFAULT_UNIT = 14.8;

export interface RackFitDevice {
  code: string;
  cabinetId: string | null;
  cabinetCode: string | null;
  u: number | null;
  uSize: number | null;
}

export interface RackFitResult {
  /** Mục `u` của lệnh `patch` (theo id ô). */
  updates: Record<string, { geometry?: string; style?: string }>;
  /** Máy kho ghi tủ khác khung — không đặt theo U, màn báo người vẽ. */
  cabinetMismatch: { cellId: string; code: string; deviceCabinet: string | null; frameLabel: string }[];
  /** Máy cùng tủ nhưng kho chưa khai U — giữ chỗ thả, cao theo Số U (vắng = 1U). */
  noU: { cellId: string; code: string }[];
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
export function withLabelPlacement(style: string, placement: string): string {
  const kept = style.split(';').filter((token) => token !== '' && !LABEL_KEYS.includes(token.split('=')[0]));
  return `${kept.length > 0 ? `${kept.join(';')};` : ''}${placement}`;
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
  geo: { x: number; y: number; width: number; height: number } | null;
}

function readCells(xml: string): Cell[] {
  if (!xml || !xml.trim()) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return [];
  return Array.from(doc.getElementsByTagName('mxCell')).map((cell) => {
    const wrapper = cell.parentElement && (cell.parentElement.nodeName === 'UserObject' || cell.parentElement.nodeName === 'object') ? cell.parentElement : null;
    const g = Array.from(cell.children).find((c) => c.tagName === 'mxGeometry');
    const num = (name: string) => Number(g?.getAttribute(name) ?? 0) || 0;
    return {
      id: (wrapper ?? cell).getAttribute('id') ?? '',
      parent: cell.getAttribute('parent'),
      style: cell.getAttribute('style') ?? '',
      deviceId: wrapper?.getAttribute('ims_device_id') || null,
      cabinetId: wrapper?.getAttribute('ims_cabinet_id') || null,
      label: wrapper?.getAttribute('label') ?? cell.getAttribute('value') ?? '',
      geo: g ? { x: num('x'), y: num('y'), width: num('width'), height: num('height') } : null,
    };
  });
}

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
  for (const cell of cells) {
    if (!cell.deviceId) continue;
    const frame = cell.parent ? racks.get(cell.parent) : undefined;
    if (!frame) {
      // Kéo ra khỏi khung tủ: nhãn bên phải không còn đúng chỗ.
      const outside = !cell.parent || !anyRack.has(cell.parent);
      if (outside && styleMap(cell.style).get('labelPosition') === 'right') result.updates[cell.id] = { style: withLabelPlacement(cell.style, BELOW_STYLE) };
      continue;
    }
    const info = devices.get(cell.deviceId);
    if (!info) {
      if (!result.unknown.includes(cell.deviceId)) result.unknown.push(cell.deviceId);
      continue;
    }
    if (info.cabinetId !== frame.cabinetId) {
      result.cabinetMismatch.push({ cellId: cell.id, code: info.code, deviceCabinet: info.cabinetCode, frameLabel: frame.label });
      continue;
    }
    const s = styleMap(frame.style);
    const unit = Number(s.get('rackUnitSize')) || DEFAULT_UNIT;
    const left = Number(s.get('marginLeft')) || 0;
    const right = Number(s.get('marginRight')) || 0;
    const top = Number(s.get('marginTop')) || 0;
    const bottom = Number(s.get('marginBottom')) || 0;
    const fg = frame.geo;
    const height = Math.round((fg.height - top - bottom) / unit);
    const size = info.uSize && info.uSize > 0 ? info.uSize : 1;
    const place = { x: left, width: r1(fg.width - left - right), height: r1(size * unit), y: cell.geo?.y ?? top };
    if (info.u === null) {
      result.noU.push({ cellId: cell.id, code: info.code });
    } else if (info.u >= 1 && info.u + size - 1 <= height) {
      place.y = r1(top + (height - (info.u + size - 1)) * unit);
    }
    const update: { geometry?: string; style?: string } = {};
    const g = cell.geo;
    if (!g || !near(g.x, place.x) || !near(g.y, place.y) || !near(g.width, place.width) || !near(g.height, place.height)) {
      update.geometry = `<mxGeometry x="${r1(place.x)}" y="${r1(place.y)}" width="${place.width}" height="${place.height}" as="geometry"/>`;
    }
    const style = withLabelPlacement(cell.style, RACK_LABEL_STYLE);
    if (style !== cell.style) update.style = style;
    if (update.geometry || update.style) result.updates[cell.id] = update;
  }
  return result;
}

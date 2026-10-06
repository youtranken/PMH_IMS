import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { rackUnitLabel } from '../../common/rack-units';
import { escapeXmlAttr, escapeXmlText } from '../../common/svg-sanitize';
import { PALETTE } from '../../common/palette.generated';
import { DIAGRAM_ICON_SIZE, DIAGRAM_SHAPE_OTHER, diagramShapeDef } from '../catalog/catalog.api';
import { buildCellIndex, isPortEndCell, PORT_END_MARK } from './diagram-cells';
import { cableEdgeStates, type CableEdge } from './diagram-checks';
import type { CheckLink } from './diagram-finding';

/**
 * XML bản vẽ "khô" ↔ "ướt" (AD-18) — hàm THUẦN, test bảng dữ liệu ở `diagram-hydrate.spec.ts`.
 *
 * Kho bản vẽ chỉ giữ phần người vẽ làm ra (vị trí, cỡ, màu tự chọn, chữ tự do) cộng hợp đồng
 * `ims_device_id` + `ims_device_code`. Hình theo loại, nhãn mã/IP/vị trí và dấu cảnh báo là thứ
 * IMS dựng lại từ kho MỖI LẦN MỞ (hydrate) rồi gỡ ra MỖI LẦN LƯU (dehydrate). Nhờ vậy đổi hình
 * của một loại ở Danh mục, đổi IP hay thanh lý máy hiện ngay trên mọi bản vẽ mà không ai phải
 * sửa bản vẽ, và phiên bản cũ không giữ một bản chụp lỗi thời của kho trong chính nét vẽ.
 *
 * Chỉ chạy trên XML đã qua cổng kiểm (`diagram-gate.ts`) hoặc lấy từ kho (đã qua cổng lúc lưu).
 */

/**
 * Khoá style của ô thiết bị do IMS làm chủ: hydrate đặt, dehydrate gỡ. Người vẽ đổi các khoá này
 * trong draw.io thì lần mở sau bị đặt lại — hình, cách đọc nhãn (`html=0`: tên máy không bao giờ
 * được đọc như HTML) và chỗ đặt nhãn so với hình đi theo loại thiết bị, không theo từng bản vẽ.
 */
export const IMS_STYLE_KEYS = [
  'shape',
  'image',
  'imageAspect',
  'aspect',
  'outlineConnect',
  'html',
  'verticalLabelPosition',
  'verticalAlign',
  'labelPosition',
  'align',
  'spacingLeft',
];

/**
 * Nhãn máy trong khung tủ (Q-23 05/10): bên PHẢI ô, giữa theo chiều cao — nhãn dưới hình của một
 * máy 1U rơi xuống đè lên các U bên dưới. `spacingLeft` đẩy chữ qua thanh ray phải của hình tủ.
 */
export const RACK_LABEL_STYLE = 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=14;';
const LABEL_PLACEMENT_KEYS = ['labelPosition', 'verticalLabelPosition', 'align', 'verticalAlign', 'spacingLeft'];

/** Ảnh thật (không phải biểu tượng SVG) trong style ô — `image=data:image/png|jpeg…`. */
const PHOTO_IMAGE_RE = /(?:^|;)image=data:image\/(?!svg)/;

/**
 * Style ô máy nằm trong khung tủ: bỏ chỗ đặt nhãn cũ, nhãn bên phải. Ảnh thật lấp ĐẦY ô n U
 * (`imageAspect=0`, bỏ `aspect=fixed`) — ô cao đúng n U là sự thật của tủ, ảnh cắt theo mặt tủ thì
 * không méo, còn ảnh cũ chưa cắt (còn viền) mà giữ tỉ lệ thì co thành một vạch (Q-23 06/10 C).
 * Web giữ cùng luật ở `rackCellStyle` (`rack-fit.ts`).
 */
export function rackDeviceStyle(style: string): string {
  if (!PHOTO_IMAGE_RE.test(style)) return `${styleWithoutIms(style, LABEL_PLACEMENT_KEYS)}${RACK_LABEL_STYLE}`;
  return `${styleWithoutIms(style, [...LABEL_PLACEMENT_KEYS, 'imageAspect', 'aspect'])}imageAspect=0;${RACK_LABEL_STYLE}`;
}

/** Thuộc tính dữ liệu của ô thiết bị ngoài hợp đồng mà bản chèn cũ từng ghi — dehydrate gỡ. */
const LEGACY_DATA_ATTRS = new Set(['ims_device_ip', 'ims_device_type']);

/**
 * Ảnh thật (AD-18): `ims_photo` = mặt người vẽ chọn hiện (`front` | `back`), lưu trong XML khô;
 * `ims_photo_file_id` = ảnh đang dùng lúc mở (ảnh riêng máy đè ảnh model) — hydrate đặt cùng ảnh
 * nhúng, dehydrate gỡ, để đổi ảnh ở trang thiết bị hiện trên mọi bản vẽ từ lần mở sau.
 */
export const PHOTO_SIDE_ATTR = 'ims_photo';
export const PHOTO_FILE_ATTR = 'ims_photo_file_id';
export type PhotoSide = 'front' | 'back';

/** Ảnh một mặt đã thu nhỏ: id tệp + data URI dạng draw.io (`data:image/png,<base64>`). */
export interface DevicePhoto {
  fileId: string;
  uri: string;
  /** Cỡ ảnh đã thu nhỏ (cùng tỉ lệ ảnh gốc) — ô ảnh lấy tỉ lệ cao/rộng từ đây. */
  width: number;
  height: number;
}

/**
 * Chặn tỉ lệ cao/rộng của ô ảnh: mặt máy 1U cắt chuẩn (482,6 : 44,45 ≈ 0,092) phải lọt để ô ra
 * đúng một dải 1U; mỏng hơn nữa thì thành vạch. Ảnh dọc không cao vọt khỏi trang.
 */
const PHOTO_ASPECT_MIN = 0.08;
const PHOTO_ASPECT_MAX = 2;

/**
 * Tỉ lệ cao/rộng của ô hiện ảnh thật (Q-23): ô ôm sát ảnh thay vì ảnh nằm giữa một ô vuông với hai
 * dải trống trên dưới (nhãn rơi xa khỏi ảnh). Một chỗ tính cho ô chèn mới và công tắc đổi hình
 * (web nhân `rộng × tỉ lệ`); không biết cỡ thì vuông như biểu tượng.
 */
export function photoAspect(size: { width: number; height: number }): number {
  if (!(size.width > 0 && size.height > 0)) return 1;
  return Math.min(PHOTO_ASPECT_MAX, Math.max(PHOTO_ASPECT_MIN, size.height / size.width));
}

/**
 * Ảnh dạng draw.io nhận trong style: `data:<mime>,<base64>` — bỏ chữ `;base64` vì `;` là dấu tách
 * khoá của chuỗi style; draw.io tự thêm lại lúc vẽ (cổng kiểm nhận cả hai dạng).
 */
export function photoDataUri(mime: string, bytes: Buffer): string {
  return `data:${mime},${bytes.toString('base64')}`;
}

function photoSideOf(value: string | undefined): PhotoSide | null {
  return value === 'front' || value === 'back' ? value : null;
}

const WARN_MISSING = '⚠ Không tìm thấy trong kho';
const WARN_RETIRED = '⚠ Đã thanh lý';

/** Những gì hydrate cần biết về một máy — đọc qua `devices.api`/`ipam.api`/`catalog.api`. */
export interface DeviceCellSource {
  /** `false` = `ims_device_id` không còn (hoặc chưa bao giờ có) trong kho. */
  found: boolean;
  code: string;
  status: string | null;
  ips: string[];
  siteCode: string | null;
  cabinetCode: string | null;
  /** U thấp nhất máy chiếm trong tủ (U1 = đáy); `null` = chưa khai. */
  u: number | null;
  /** Số U máy chiếm; vắng/`null` = 1. */
  uSize?: number | null;
  /** Cảnh báo vị trí (vd U vượt chiều cao tủ — dữ liệu cũ) — thêm một dòng ở nhãn. */
  rackWarning?: string | null;
  /** Ảnh thật đã thu nhỏ của từng mặt — chỉ mặt nào ô trên bản vẽ cần mới có. */
  photos?: Partial<Record<PhotoSide, DevicePhoto>>;
  /** Hình của loại (`device_type.diagram_shape`); `null` = "Thiết bị khác". */
  shape: string | null;
  /** SVG riêng của loại, đã lọc lúc tải lên; có thì thắng `shape`. */
  iconSvg: string | null;
}

/** Nhãn ô thiết bị: mã · IP · "Site · Tủ · U", thêm dòng cảnh báo khi máy đã thanh lý/không còn. */
export function deviceCellLabel(device: DeviceCellSource): string {
  if (!device.found) return [device.code, WARN_MISSING].join('\n');
  const ip = device.ips.length === 0 ? null : device.ips.length === 1 ? device.ips[0] : `${device.ips[0]} (+${device.ips.length - 1})`;
  const where = [device.siteCode, device.cabinetCode, rackUnitLabel(device.u, device.uSize)].filter(Boolean).join(' · ');
  const lines = [device.code, ip, where || null];
  if (device.rackWarning) lines.push(device.rackWarning);
  if (device.status === 'retired') lines.push(WARN_RETIRED);
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

/**
 * Nhãn MỘT dòng của máy trong khung tủ: mã · IP (+ dấu cảnh báo). Vị trí (site · tủ · U) đã là
 * chính khung tủ — nhãn ba dòng cạnh một máy 1U chồng lên nhãn của máy trên dưới.
 */
export function deviceRackLabel(device: DeviceCellSource): string {
  if (!device.found) return [device.code, WARN_MISSING].join(' · ');
  const ip = device.ips.length === 0 ? null : device.ips.length === 1 ? device.ips[0] : `${device.ips[0]} (+${device.ips.length - 1})`;
  const parts = [device.code, ip, device.rackWarning ?? null, device.status === 'retired' ? WARN_RETIRED : null];
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/**
 * Phần style IMS đặt cho ô thiết bị. Ảnh SVG mã hoá URL (`%3Csvg…`), không base64: giá trị
 * không chứa `;` nên không cắt nhầm chuỗi style `k=v;`, và cổng kiểm đọc được chữ bên trong.
 */
export function deviceLookStyle(
  look: { shape: string | null; iconSvg: string | null; found: boolean; photos?: Partial<Record<PhotoSide, DevicePhoto>> },
  side: PhotoSide | null = null,
): string {
  // Ảnh thật giữ tỉ lệ ảnh trong khung ô (`imageAspect=1`): ô của máy trong khung tủ cao đúng số U.
  const photo = side && look.found ? look.photos?.[side] : undefined;
  if (photo) return `shape=image;image=${photo.uri};imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;`;
  if (look.found && look.iconSvg) {
    const uri = `data:image/svg+xml,${encodeURIComponent(look.iconSvg)}`;
    return `shape=image;image=${uri};imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;`;
  }
  if (look.found && diagramShapeDef(look.shape)) {
    return `shape=${look.shape};outlineConnect=0;verticalLabelPosition=bottom;verticalAlign=top;html=0;`;
  }
  return 'verticalLabelPosition=middle;verticalAlign=middle;html=0;';
}

/**
 * Ô mới để chèn: style = mặc định của người vẽ (sửa được) + phần IMS. `width` = bề rộng chuẩn
 * `diagram.device_width_px` (Q-23 06/10 E — mọi máy trên trang tự do cùng rộng, cao theo tỉ lệ
 * hình); vắng thì cỡ riêng của hình.
 */
export function deviceInsertCell(
  device: DeviceCellSource,
  width?: number,
): {
  style: string;
  label: string;
  width: number;
  height: number;
  /** Thuộc tính `ims_*` thêm vào ô mới — ô có ảnh thật mang mặt đang hiện + id ảnh. */
  attrs: Record<string, string>;
} {
  const label = deviceCellLabel(device);
  /*
   * Máy có ảnh (riêng của máy, không có thì của model — `photos` đã tra theo thứ tự đó ở `devices`)
   * thì ô mới hiện ảnh mặt trước; người vẽ đổi về biểu tượng ở "Ảnh thật…". Rộng như biểu tượng,
   * cao theo tỉ lệ ảnh.
   */
  const front = device.found ? device.photos?.front : undefined;
  if (front) {
    const w = width ?? DIAGRAM_ICON_SIZE.width;
    return {
      style: `align=center;${deviceLookStyle(device, 'front')}`,
      label,
      width: w,
      height: Math.round(w * photoAspect(front)),
      attrs: { [PHOTO_SIDE_ATTR]: 'front', [PHOTO_FILE_ATTR]: front.fileId },
    };
  }
  const cell = deviceIconCell(device, label);
  if (width) return { ...cell, width, height: Math.round((width * cell.height) / cell.width), attrs: {} };
  return { ...cell, attrs: {} };
}

/** Tỉ lệ cao/rộng của ô biểu tượng — công tắc "Ảnh thật" đổi ô ảnh về biểu tượng giữ rộng, cao theo đây. */
export function deviceIconAspect(device: DeviceCellSource): number {
  const cell = deviceIconCell(device, '');
  return cell.height / cell.width;
}

/**
 * Màu mặc định của biểu tượng khi CHÈN (V-10), như bảng hình của draw.io: thư viện mạng tô xám +
 * viền xanh, thư viện Cisco khối màu viền + nét trắng. Không phải khoá IMS — người vẽ đổi màu thì
 * hydrate giữ nguyên. Màu đọc từ token qua `PALETTE`, không viết tay.
 */
function iconColors(shapeKey: string | null): string {
  if (shapeKey?.startsWith('mxgraph.cisco.')) return `fillColor=${PALETTE.diagramIconStroke};strokeColor=${PALETTE.surface};gradientColor=none;`;
  return `fillColor=${PALETTE.diagramIconFill};strokeColor=${PALETTE.diagramIconStroke};gradientColor=none;strokeWidth=2;`;
}

function deviceIconCell(device: DeviceCellSource, label: string): { style: string; label: string; width: number; height: number } {
  const look = deviceLookStyle(device);
  if (device.found && device.iconSvg) return { style: `align=center;${look}`, label, ...DIAGRAM_ICON_SIZE };
  const shape = device.found ? diagramShapeDef(device.shape) : null;
  if (shape) return { style: `align=center;${iconColors(shape.key)}${look}`, label, width: shape.width, height: shape.height };
  return {
    style: `rounded=1;whiteSpace=wrap;align=center;${iconColors(null)}${look}`,
    label,
    width: DIAGRAM_SHAPE_OTHER.width,
    height: DIAGRAM_SHAPE_OTHER.height,
  };
}

/* ------------------------------------------------------------- chuỗi style --- */

/** Bỏ các khoá IMS (mặc định: của ô thiết bị) khỏi style draw.io (`k=v;k=v;` có thể mở đầu bằng tên style không có `=`). */
export function styleWithoutIms(style: string, keys: readonly string[] = IMS_STYLE_KEYS): string {
  const tokens = style.split(';');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '') continue;
    const key = token.includes('=') ? token.slice(0, token.indexOf('=')).trim() : null;
    if (key !== null && keys.includes(key)) {
      // `image=data:image/png;base64,AAA` bị `;` cắt làm hai mẩu: gỡ cả mẩu đuôi.
      if (key === 'image' && tokens[i + 1]?.startsWith('base64,')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept.length > 0 ? `${kept.join(';')};` : '';
}

/* ------------------------------------------------------------- dây của kho --- */

/**
 * Khoá style của nét dây "của kho" (mang `ims_link_id`, hoặc nối hai máy kho) do IMS làm chủ.
 * `imsPaint` là ô màu IMS (`cable-<n>` theo `cable_type.color_slot`, `warn`, `danger`): server
 * không biết theme, nên web đổi nó thành `strokeColor` đọc từ token lúc nạp trình vẽ — màu dây
 * không bao giờ đọc từ `strokeColor` lưu trong XML.
 */
export const IMS_EDGE_STYLE_KEYS = ['strokeColor', 'fontColor', 'dashed', 'html', 'imsPaint'];

const EDGE_REMOVED = '⚠ Kết nối đã bị gỡ khỏi sơ đồ cổng';
const EDGE_UNDECLARED = '⚠ Chưa khai vào sơ đồ cổng';
const EDGE_MISMATCH = '⚠ Kết nối không khớp hai máy ở hai đầu dây';

/** Nét lệch nói ngay trên bản vẽ phải nối máy nào (Q-23) — dữ liệu cũ thiếu mã máy thì câu chung. */
function mismatchLabel(link: CheckLink | undefined): string {
  if (!link?.codeA || !link.codeB) return EDGE_MISMATCH;
  return `⚠ Dây ${link.portA ?? '—'} ↔ ${link.portB ?? '—'} phải nối ${link.codeA} ↔ ${link.codeB} — kéo đầu dây về đúng máy`;
}
const EDGE_DUPLICATE = '⚠ Hai dây cùng một kết nối';

/** Dòng sơ đồ cổng hydrate cần biết (đọc qua `devices.api`) + ô màu của từng loại dây (`catalog.api`). */
export interface CableHydration {
  links: Map<string, CheckLink>;
  /** `cable_type.id` → `color_slot`. */
  slots: Map<string, number>;
}

/** Nhãn cổng đọc từ đầu nguồn của nét: "Gi0/24 ↔ Te1/0/1". Cổng đầu kia chưa ghi thì "—". */
export function linkLabelFrom(link: CheckLink, sourceDeviceId: string | null): string {
  const ends = linkPortEnds(link, sourceDeviceId);
  return `${ends.source} ↔ ${ends.target}`;
}

/** Cổng ở đầu nguồn / đầu đích của nét (nét vẽ từ máy B thì đầu nguồn là cổng của B). */
export function linkPortEnds(link: CheckLink, sourceDeviceId: string | null): { source: string; target: string } {
  const a = link.portA ?? '—';
  const b = link.portB ?? '—';
  return sourceDeviceId === link.deviceB ? { source: b, target: a } : { source: a, target: b };
}

/**
 * Cờ trên nét dây của kho, LƯU trong XML khô: nhãn cổng đặt ở hai đầu dây (sát máy giữ cổng đó)
 * thay cho một nhãn "A ↔ B" giữa dây (Q-23 06/10). Nét cũ không có cờ giữ nhãn giữa — chỉ đổi khi
 * người vẽ đụng tới nét, để mở bản vẽ không bao giờ sinh thay đổi ngầm.
 */
export const PORT_LABELS_ATTR = 'ims_port_labels';
export const PORT_LABELS_ENDS = 'ends';

/**
 * Chỗ đặt nhãn đầu dây trên nét (toạ độ tương đối của draw.io: -1 = đầu nguồn, 1 = đầu đích).
 * Không ±1: ở đúng đầu mút thì nhãn đè lên viền hình máy.
 */
export const PORT_END_OFFSET = 0.75;

/** Đuôi id của hai ô nhãn đầu dây (con của nét): id cố định theo nét nên dựng lại không nhân đôi. */
export const PORT_END_SUFFIX = { source: '-ims-ps', target: '-ims-pt' } as const;


/**
 * Style ô nhãn đầu dây: nhãn cạnh của draw.io (nền giấy che nét), chữ theo màu loại dây (`imsPaint`,
 * web chỉ tô màu chữ cho ô có `imsPortEnd`). `imsPortEnd` là dấu để dehydrate nhận ra ô của IMS.
 */
export function portEndStyle(slot: number | null | undefined): string {
  return `edgeLabel;${PORT_END_MARK};imsPaint=${paintOf(slot)};html=0;fontSize=10;resizable=0;`;
}

function portEndCellXml(edgeId: string, side: 'source' | 'target', text: string, style: string): string {
  const x = side === 'source' ? -PORT_END_OFFSET : PORT_END_OFFSET;
  return (
    `<mxCell id="${escapeXmlAttr(edgeId + PORT_END_SUFFIX[side])}" value="${escapeXmlAttr(text)}" style="${escapeXmlAttr(style)}" vertex="1" connectable="0" parent="${escapeXmlAttr(edgeId)}">` +
    `<mxGeometry x="${x}" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`
  );
}


function paintOf(slot: number | null | undefined): string {
  return `cable-${slot ?? 0}`;
}

/**
 * Ô dây mới cho "Vẽ vào" / chèn sau "Khai kết nối" / dựng nháp: đã gắn `ims_link_id` +
 * `ims_cable_type_id` + cờ nhãn hai đầu, ô màu như lúc hydrate; `ends` = chữ hai ô nhãn đầu dây
 * web chèn kèm — cùng một luật nên nét chèn vào và nét hiện lần mở sau là một.
 */
export function linkEdgeCell(
  link: CheckLink,
  at: { sourceDeviceId: string; slot: number | null },
): { label: string; style: string; attrs: Record<string, string>; ends: { source: string; target: string } } {
  return {
    label: '',
    style: `edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=none;imsPaint=${paintOf(at.slot)};html=0;`,
    attrs: { ims_link_id: link.id, ims_cable_type_id: link.cableTypeId ?? '', [PORT_LABELS_ATTR]: PORT_LABELS_ENDS },
    ends: linkPortEnds(link, at.sourceDeviceId),
  };
}

/* ------------------------------------------------------------- viết lại XML --- */

type Attrs = Record<string, string>;

interface DeviceContext {
  id: string;
  code: string;
  photo: PhotoSide | null;
  /** Ô là con của một khung tủ (`childLayout=rack`) — nhãn bên phải, một dòng. */
  inRack: boolean;
}

/** Ô dây "của kho" và trạng thái của nó (luật ở `diagram-checks.ts`). */
type EdgeContext = CableEdge;

interface CellEdit {
  device: { data: (attrs: Attrs, device: DeviceContext) => Attrs; cell: (attrs: Attrs, device: DeviceContext) => Attrs };
  /**
   * `wrapped` = nét bọc trong `UserObject` (nhãn ở thuộc tính `label`), không thì nhãn ở `value` của
   * `mxCell`. `after`: XML chèn ngay sau nét bọc (ô nhãn đầu dây — con của nét, phải đứng sau nó).
   */
  edge: {
    data: (attrs: Attrs, edge: EdgeContext) => Attrs;
    cell: (attrs: Attrs, edge: EdgeContext, wrapped: boolean) => Attrs;
    after?: (attrs: Attrs, edge: EdgeContext) => string;
  };
}

/**
 * Đọc XML rồi ghi lại y nguyên, cho phép sửa thuộc tính ô thiết bị (`UserObject`/`object` mang
 * `ims_device_id` + `mxCell` bên trong) và ô dây của kho (`edges`, theo id ô). Ghi chú và khai báo
 * XML không giữ: draw.io không đọc chúng, cổng kiểm không cần chúng. Ô nhãn đầu dây của lần hydrate
 * trước luôn bị bỏ — hydrate dựng lại từ sơ đồ cổng hiện tại, dehydrate không lưu chúng.
 */
function rewriteCells(xml: string, edges: Map<string, EdgeContext>, edit: CellEdit): string {
  const inRack = rackChildIds(xml);
  const out: string[] = [];
  const stack: { device: DeviceContext | null; edge: EdgeContext | null; after: string }[] = [];
  /** Độ sâu còn lại của cây con đang bỏ (ô nhãn đầu dây); 0 = không bỏ. */
  let skipping = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    if (skipping > 0) {
      if (!tag.isSelfClosing) skipping += 1;
      return;
    }
    const raw: Attrs = tag.attributes;
    if ((tag.name === 'mxCell' || tag.name === 'UserObject' || tag.name === 'object') && isPortEndCell(raw)) {
      if (!tag.isSelfClosing) skipping = 1;
      return;
    }
    let attrs: Attrs = { ...tag.attributes };
    let device: DeviceContext | null = null;
    let edge: EdgeContext | null = null;
    const parent = stack[stack.length - 1];
    if ((tag.name === 'UserObject' || tag.name === 'object') && attrs.ims_device_id) {
      device = { id: attrs.ims_device_id, code: attrs.ims_device_code ?? '', photo: photoSideOf(attrs[PHOTO_SIDE_ATTR]), inRack: inRack.has(attrs.id ?? '') };
      attrs = edit.device.data(attrs, device);
    } else if ((tag.name === 'UserObject' || tag.name === 'object') && edges.has(attrs.id ?? '')) {
      edge = edges.get(attrs.id)!;
      attrs = edit.edge.data(attrs, edge);
    } else if (tag.name === 'mxCell' && parent?.device) {
      attrs = edit.device.cell(attrs, parent.device);
    } else if (tag.name === 'mxCell' && parent?.edge) {
      attrs = edit.edge.cell(attrs, parent.edge, true);
    } else if (tag.name === 'mxCell' && edges.has(attrs.id ?? '')) {
      attrs = edit.edge.cell(attrs, edges.get(attrs.id)!, false);
    }
    const text = Object.entries(attrs)
      .map(([name, value]) => ` ${name}="${escapeXmlAttr(value)}"`)
      .join('');
    out.push(`<${tag.name}${text}${tag.isSelfClosing ? '/>' : '>'}`);
    const after = edge && edit.edge.after ? edit.edge.after(attrs, edge) : '';
    if (!tag.isSelfClosing) stack.push({ device, edge, after });
    else if (after) out.push(after);
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (skipping > 0) {
      if (!tag.isSelfClosing) skipping -= 1;
      return;
    }
    if (tag.isSelfClosing) return;
    const closed = stack.pop();
    out.push(`</${tag.name}>`);
    if (closed?.after) out.push(closed.after);
  });
  parser.on('text', (text) => {
    if (skipping === 0) out.push(escapeXmlText(text));
  });
  parser.on('cdata', (text) => {
    if (skipping === 0) out.push(escapeXmlText(text));
  });
  parser.write(xml).close();
  return out.join('');
}

/**
 * Id các ô là con trực tiếp của một khung tủ (hình có `childLayout=rack` — khung tủ IMS dựng hay
 * người vẽ lấy từ thư viện rack). Đọc một lượt trước khi viết lại: `parent` nằm trên `mxCell`,
 * còn nhãn nằm trên `UserObject` bọc nó, đọc trước.
 */
function rackChildIds(xml: string): Set<string> {
  const racks = new Set<string>();
  const parentOf = new Map<string, string>();
  let wrapperId: string | null = null;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const attrs = tag.attributes as Record<string, string>;
    if (tag.name === 'UserObject' || tag.name === 'object') wrapperId = attrs.id ?? null;
    else if (tag.name === 'mxCell') {
      const id = attrs.id ?? wrapperId ?? '';
      if (attrs.parent) parentOf.set(id, attrs.parent);
      if (/(?:^|;)childLayout=rack(?:;|$)/.test(attrs.style ?? '')) racks.add(id);
    }
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (tag.name === 'UserObject' || tag.name === 'object') wrapperId = null;
  });
  parser.write(xml).close();
  return new Set([...parentOf].filter(([, parent]) => racks.has(parent)).map(([id]) => id));
}

/** Giữ thứ tự thuộc tính, chỉ thay giá trị (hoặc thêm cuối) — diff XML giữa hai lần lưu gọn. */
function withAttr(attrs: Attrs, name: string, value: string): Attrs {
  return { ...attrs, [name]: value };
}

/** Nét dây của kho theo id ô. `links` vắng (dehydrate) thì chỉ cần biết nét nào là của kho. */
function edgesOf(xml: string, links: Map<string, CheckLink>): Map<string, EdgeContext> {
  return new Map(cableEdgeStates(buildCellIndex(xml).cells, links).map((edge) => [edge.cellId, edge]));
}

/** Nét đã khai mang cờ nhãn hai đầu: nhãn giữa rỗng, chữ nằm ở hai ô nhãn đầu dây. */
function endsLabelled(attrs: Attrs, edge: EdgeContext): boolean {
  return edge.state === 'linked' && attrs[PORT_LABELS_ATTR] === PORT_LABELS_ENDS;
}

function edgeLabel(edge: EdgeContext, links: Map<string, CheckLink>, ends = false): string {
  switch (edge.state) {
    case 'linked':
      return ends ? '' : linkLabelFrom(links.get(edge.linkId!)!, edge.sourceDeviceId);
    case 'removed':
      return EDGE_REMOVED;
    case 'mismatch':
      return mismatchLabel(links.get(edge.linkId!));
    case 'duplicate':
      return EDGE_DUPLICATE;
    default:
      return EDGE_UNDECLARED;
  }
}

function edgePaint(edge: EdgeContext, cables: CableHydration): string {
  if (edge.state === 'linked') {
    const link = cables.links.get(edge.linkId!)!;
    return `imsPaint=${paintOf(link.cableTypeId ? cables.slots.get(link.cableTypeId) : null)};html=0;`;
  }
  return `imsPaint=${edge.state === 'undeclared' ? 'warn' : 'danger'};dashed=1;html=0;`;
}

/**
 * XML ướt (từ trình vẽ) → XML khô để lưu: nhãn ô thiết bị về đúng mã máy (đọc được khi mất kết
 * nối kho), gỡ khoá style IMS và thuộc tính dữ liệu cũ ngoài hợp đồng; nét dây của kho về nhãn
 * rỗng, gỡ khoá màu IMS (`IMS_EDGE_STYLE_KEYS`). Hình tự do, dây nối hình tự do, chữ không bị đụng.
 */
export function dehydrateDiagramXml(xml: string): string {
  return rewriteCells(xml, edgesOf(xml, new Map()), {
    device: {
      data: (attrs, device) => {
        const kept = Object.fromEntries(Object.entries(attrs).filter(([name]) => !LEGACY_DATA_ATTRS.has(name) && name !== PHOTO_FILE_ATTR));
        return withAttr(kept, 'label', device.code);
      },
      cell: (attrs) => (attrs.style === undefined ? attrs : withAttr(attrs, 'style', styleWithoutIms(attrs.style))),
    },
    edge: {
      data: (attrs) => withAttr(attrs, 'label', ''),
      cell: (attrs, _edge, wrapped) => {
        const styled = attrs.style === undefined ? attrs : withAttr(attrs, 'style', styleWithoutIms(attrs.style, IMS_EDGE_STYLE_KEYS));
        return wrapped ? styled : withAttr(styled, 'value', '');
      },
    },
  });
}

/**
 * XML khô (từ kho) → XML ướt để nạp trình vẽ: hình theo loại, nhãn từ kho hiện tại, dấu cảnh
 * báo; nét dây của kho mang nhãn cổng + ô màu theo dòng sơ đồ cổng HIỆN TẠI (đổi cổng/loại dây ở
 * trang thiết bị hiện ngay), nét có kết nối đã gỡ thì đỏ, nét chưa khai thì vàng. `devices` thiếu
 * một id (máy đã xoá, id rác) thì ô đó hiện "Không tìm thấy trong kho" — không bao giờ làm hỏng
 * cả bản vẽ.
 */
export function hydrateDiagramXml(
  xml: string,
  devices: Map<string, DeviceCellSource>,
  cables: CableHydration = { links: new Map(), slots: new Map() },
): string {
  const sourceOf = (device: DeviceContext): DeviceCellSource =>
    devices.get(device.id) ?? {
      found: false,
      code: device.code,
      status: null,
      ips: [],
      siteCode: null,
      cabinetCode: null,
      u: null,
      shape: null,
      iconSvg: null,
    };
  return rewriteCells(xml, edgesOf(xml, cables.links), {
    device: {
      data: (attrs, device) => {
        const kept = Object.fromEntries(Object.entries(attrs).filter(([name]) => !LEGACY_DATA_ATTRS.has(name) && name !== PHOTO_FILE_ATTR));
        const source = sourceOf(device);
        const labeled = withAttr(kept, 'label', device.inRack ? deviceRackLabel(source) : deviceCellLabel(source));
        const photo = device.photo && source.found ? source.photos?.[device.photo] : undefined;
        return photo ? withAttr(labeled, PHOTO_FILE_ATTR, photo.fileId) : labeled;
      },
      cell: (attrs, device) => {
        const look = `${styleWithoutIms(attrs.style ?? '')}${deviceLookStyle(sourceOf(device), device.photo)}`;
        return withAttr(attrs, 'style', device.inRack ? rackDeviceStyle(look) : look);
      },
    },
    edge: {
      data: (attrs, edge) => {
        const labeled = withAttr(attrs, 'label', edgeLabel(edge, cables.links, endsLabelled(attrs, edge)));
        if (edge.state !== 'linked') return labeled;
        return withAttr(labeled, 'ims_cable_type_id', cables.links.get(edge.linkId!)!.cableTypeId ?? '');
      },
      cell: (attrs, edge, wrapped) => {
        const styled = withAttr(attrs, 'style', `${styleWithoutIms(attrs.style ?? '', IMS_EDGE_STYLE_KEYS)}${edgePaint(edge, cables)}`);
        return wrapped ? styled : withAttr(styled, 'value', edgeLabel(edge, cables.links));
      },
      after: (attrs, edge) => {
        if (!endsLabelled(attrs, edge)) return '';
        const link = cables.links.get(edge.linkId!)!;
        const ends = linkPortEnds(link, edge.sourceDeviceId);
        const style = portEndStyle(link.cableTypeId ? cables.slots.get(link.cableTypeId) : null);
        return portEndCellXml(edge.cellId, 'source', ends.source, style) + portEndCellXml(edge.cellId, 'target', ends.target, style);
      },
    },
  });
}

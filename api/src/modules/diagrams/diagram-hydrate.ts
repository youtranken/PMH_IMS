import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { escapeXmlAttr, escapeXmlText } from '../../common/svg-sanitize';
import { DIAGRAM_ICON_SIZE, DIAGRAM_SHAPE_OTHER, diagramShapeDef } from '../catalog/catalog.api';

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
export const IMS_STYLE_KEYS = ['shape', 'image', 'imageAspect', 'aspect', 'outlineConnect', 'html', 'verticalLabelPosition', 'verticalAlign'];

/** Thuộc tính dữ liệu của ô thiết bị ngoài hợp đồng mà bản chèn cũ từng ghi — dehydrate gỡ. */
const LEGACY_DATA_ATTRS = new Set(['ims_device_ip', 'ims_device_type']);

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
  /** Vị trí U trong tủ — `null` tới khi kho có cột U (Story 10.11). */
  u: number | null;
  /** Hình của loại (`device_type.diagram_shape`); `null` = "Thiết bị khác". */
  shape: string | null;
  /** SVG riêng của loại, đã lọc lúc tải lên; có thì thắng `shape`. */
  iconSvg: string | null;
}

/** Nhãn ô thiết bị: mã · IP · "Site · Tủ · U", thêm dòng cảnh báo khi máy đã thanh lý/không còn. */
export function deviceCellLabel(device: DeviceCellSource): string {
  if (!device.found) return [device.code, WARN_MISSING].join('\n');
  const ip = device.ips.length === 0 ? null : device.ips.length === 1 ? device.ips[0] : `${device.ips[0]} (+${device.ips.length - 1})`;
  const where = [device.siteCode, device.cabinetCode, device.u !== null ? `U${device.u}` : null].filter(Boolean).join(' · ');
  const lines = [device.code, ip, where || null];
  if (device.status === 'retired') lines.push(WARN_RETIRED);
  return lines.filter((line): line is string => Boolean(line)).join('\n');
}

/**
 * Phần style IMS đặt cho ô thiết bị. Ảnh SVG mã hoá URL (`%3Csvg…`), không base64: giá trị
 * không chứa `;` nên không cắt nhầm chuỗi style `k=v;`, và cổng kiểm đọc được chữ bên trong.
 */
export function deviceLookStyle(look: { shape: string | null; iconSvg: string | null; found: boolean }): string {
  if (look.found && look.iconSvg) {
    const uri = `data:image/svg+xml,${encodeURIComponent(look.iconSvg)}`;
    return `shape=image;image=${uri};imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;`;
  }
  if (look.found && diagramShapeDef(look.shape)) {
    return `shape=${look.shape};outlineConnect=0;verticalLabelPosition=bottom;verticalAlign=top;html=0;`;
  }
  return 'verticalLabelPosition=middle;verticalAlign=middle;html=0;';
}

/** Ô mới để chèn: cỡ theo hình, style = mặc định của người vẽ (sửa được) + phần IMS. */
export function deviceInsertCell(device: DeviceCellSource): { style: string; label: string; width: number; height: number } {
  const look = deviceLookStyle(device);
  const label = deviceCellLabel(device);
  if (device.found && device.iconSvg) return { style: `align=center;${look}`, label, ...DIAGRAM_ICON_SIZE };
  const shape = device.found ? diagramShapeDef(device.shape) : null;
  if (shape) return { style: `align=center;${look}`, label, width: shape.width, height: shape.height };
  return {
    style: `rounded=1;whiteSpace=wrap;align=center;${look}`,
    label,
    width: DIAGRAM_SHAPE_OTHER.width,
    height: DIAGRAM_SHAPE_OTHER.height,
  };
}

/* ------------------------------------------------------------- chuỗi style --- */

/** Bỏ các khoá IMS khỏi style draw.io (`k=v;k=v;` có thể mở đầu bằng tên style không có `=`). */
export function styleWithoutIms(style: string): string {
  const tokens = style.split(';');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '') continue;
    const key = token.includes('=') ? token.slice(0, token.indexOf('=')).trim() : null;
    if (key !== null && IMS_STYLE_KEYS.includes(key)) {
      // `image=data:image/png;base64,AAA` bị `;` cắt làm hai mẩu: gỡ cả mẩu đuôi.
      if (key === 'image' && tokens[i + 1]?.startsWith('base64,')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept.length > 0 ? `${kept.join(';')};` : '';
}

/* ------------------------------------------------------------- viết lại XML --- */

type Attrs = Record<string, string>;

interface DeviceContext {
  id: string;
  code: string;
}

/**
 * Đọc XML rồi ghi lại y nguyên, cho phép sửa thuộc tính của `UserObject`/`object` mang
 * `ims_device_id` và của `mxCell` ngay bên trong nó. Ghi chú và khai báo XML không giữ: draw.io
 * không đọc chúng, cổng kiểm không cần chúng.
 */
function rewriteDeviceCells(
  xml: string,
  edit: {
    data: (attrs: Attrs, device: DeviceContext) => Attrs;
    cell: (attrs: Attrs, device: DeviceContext) => Attrs;
  },
): string {
  const out: string[] = [];
  const stack: { name: string; device: DeviceContext | null }[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    let attrs: Attrs = { ...tag.attributes };
    let device: DeviceContext | null = null;
    if ((tag.name === 'UserObject' || tag.name === 'object') && attrs.ims_device_id) {
      device = { id: attrs.ims_device_id, code: attrs.ims_device_code ?? '' };
      attrs = edit.data(attrs, device);
    } else if (tag.name === 'mxCell' && stack[stack.length - 1]?.device) {
      attrs = edit.cell(attrs, stack[stack.length - 1].device!);
    }
    const text = Object.entries(attrs)
      .map(([name, value]) => ` ${name}="${escapeXmlAttr(value)}"`)
      .join('');
    out.push(`<${tag.name}${text}${tag.isSelfClosing ? '/>' : '>'}`);
    if (!tag.isSelfClosing) stack.push({ name: tag.name, device });
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (tag.isSelfClosing) return;
    stack.pop();
    out.push(`</${tag.name}>`);
  });
  parser.on('text', (text) => out.push(escapeXmlText(text)));
  parser.on('cdata', (text) => out.push(escapeXmlText(text)));
  parser.write(xml).close();
  return out.join('');
}

/** Giữ thứ tự thuộc tính, chỉ thay giá trị (hoặc thêm cuối) — diff XML giữa hai lần lưu gọn. */
function withAttr(attrs: Attrs, name: string, value: string): Attrs {
  return { ...attrs, [name]: value };
}

/**
 * XML ướt (từ trình vẽ) → XML khô để lưu: nhãn ô thiết bị về đúng mã máy (đọc được khi mất kết
 * nối kho), gỡ khoá style IMS và thuộc tính dữ liệu cũ ngoài hợp đồng. Hình tự do, dây, chữ
 * không bị đụng.
 */
export function dehydrateDiagramXml(xml: string): string {
  return rewriteDeviceCells(xml, {
    data: (attrs, device) => {
      const kept = Object.fromEntries(Object.entries(attrs).filter(([name]) => !LEGACY_DATA_ATTRS.has(name)));
      return withAttr(kept, 'label', device.code);
    },
    cell: (attrs) => (attrs.style === undefined ? attrs : withAttr(attrs, 'style', styleWithoutIms(attrs.style))),
  });
}

/**
 * XML khô (từ kho) → XML ướt để nạp trình vẽ: hình theo loại, nhãn từ kho hiện tại, dấu cảnh
 * báo. `devices` thiếu một id (máy đã xoá, id rác) thì ô đó hiện "Không tìm thấy trong kho" —
 * không bao giờ làm hỏng cả bản vẽ.
 */
export function hydrateDiagramXml(xml: string, devices: Map<string, DeviceCellSource>): string {
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
  return rewriteDeviceCells(xml, {
    data: (attrs, device) => {
      const kept = Object.fromEntries(Object.entries(attrs).filter(([name]) => !LEGACY_DATA_ATTRS.has(name)));
      return withAttr(kept, 'label', deviceCellLabel(sourceOf(device)));
    },
    cell: (attrs, device) => withAttr(attrs, 'style', `${styleWithoutIms(attrs.style ?? '')}${deviceLookStyle(sourceOf(device))}`),
  });
}

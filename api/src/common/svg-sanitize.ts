import { SaxesParser, type SaxesTagPlain } from 'saxes';

/**
 * Bộ đọc XML an toàn + làm sạch SVG theo allowlist — hàm THUẦN, dùng chung cho cổng bản vẽ
 * (`diagrams/diagram-gate.ts`, AD-17) và biểu tượng SVG của loại thiết bị (`catalog`, Story sơ đồ
 * Thiết bị kho). Một bộ luật cho cả hai: biểu tượng tải lên đi thẳng vào bản vẽ (hydrate) rồi vào
 * ảnh xem chèn trong DOM của IMS, nên lọc lỏng hơn ở một cửa là mở lại lỗ đã vá ở cửa kia.
 *
 * Parser là `saxes`: không đọc DTD, không mở thực thể ngoài; gặp DOCTYPE là từ chối luôn.
 */

/** Một hình dạng trả về: `reason` khác `null` là từ chối (câu tiếng Việt cho người dùng). */
export interface SanitizeResult {
  value: string | null;
  reason: string | null;
}

export const BAD_SCHEME = /(?:java|vb)script:|data:text\/html/i;

/** Bỏ khoảng trắng/ký tự điều khiển mà trình duyệt cũng bỏ khi đọc URL (`java\tscript:`). */
export function squash(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u0000-\u001f]+/g, '');
}

export function sizeReason(text: string, maxKb: number, what: string): string | null {
  return Buffer.byteLength(text, 'utf8') > maxKb * 1024 ? `${what} vượt trần ${maxKb} KB.` : null;
}

export function hasDoctype(text: string): boolean {
  return /<!DOCTYPE|<!ENTITY/i.test(text);
}

/** Ném từ callback của `walkXml` để dừng với một câu lý do. */
export class XmlRejected extends Error {}

/**
 * Chạy parser, gọi `onOpen`/`onClose`/`onText` theo thứ tự tài liệu. Ném `XmlRejected` từ
 * callback để dừng với lý do; lỗi cú pháp thành `syntaxReason`.
 */
export function walkXml(
  text: string,
  syntaxReason: string,
  handlers: {
    onOpen: (tag: SaxesTagPlain) => void;
    onClose?: (tag: SaxesTagPlain) => void;
    onText?: (text: string) => void;
  },
): string | null {
  const parser = new SaxesParser({ xmlns: false });
  let failure: string | null = null;
  parser.on('error', () => {
    throw new XmlRejected(syntaxReason);
  });
  parser.on('doctype', () => {
    throw new XmlRejected('Tệp có khai báo DOCTYPE/thực thể — không nhận.');
  });
  parser.on('processinginstruction', (pi) => {
    if (pi.target.toLowerCase() !== 'xml') throw new XmlRejected(syntaxReason);
  });
  parser.on('opentag', (tag) => handlers.onOpen(tag));
  if (handlers.onClose) parser.on('closetag', handlers.onClose);
  if (handlers.onText) {
    parser.on('text', handlers.onText);
    parser.on('cdata', handlers.onText);
  }
  try {
    parser.write(text).close();
  } catch (error) {
    failure = error instanceof XmlRejected ? error.message : syntaxReason;
  }
  return failure;
}

export const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif)[;,]/i;
export const DATA_SVG = /^data:image\/svg\+xml[;,]/i;

/**
 * Chữ SVG (đã giải mã) có trỏ ra ngoài không. Khai báo không gian tên (`xmlns="http://www.w3.org/…"`)
 * là định danh, trình duyệt không tải gì từ nó — bỏ ra trước khi soi, không thì SVG hợp lệ nào
 * cũng bị coi là "có URL".
 */
export function svgTextHasUrl(text: string): boolean {
  const withoutNamespaces = text.replace(/\sxmlns(?::[\w.-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
  return /https?:|\/\//i.test(withoutNamespaces);
}

/*
 * Phần tử SVG giữ lại. `foreignObject` bị bỏ: draw.io xuất nhãn HTML dạng
 * `<switch><foreignObject>…</foreignObject><text>chữ thuần</text></switch>`, nên bỏ nó thì nhãn
 * còn ở `<text>` (đã kiểm trên draw.io 31.6.1, ghi ở AD-17). `a` bị bỏ cả cây: draw.io chỉ dùng
 * nó cho dòng "Text is not SVG" trỏ về drawio.com. `style`, `script`, `animate`/`set` bỏ cả cây.
 */
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text',
  'tspan', 'title', 'desc', 'image', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'mask', 'pattern', 'marker', 'symbol', 'use', 'switch', 'filter', 'feGaussianBlur', 'feOffset',
  'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feBlend', 'feColorMatrix', 'feDropShadow',
]);

/** Thuộc tính bỏ hẳn: `content` là bản sao nén của bản vẽ draw.io gắn vào SVG; không ai đọc nó. */
const SVG_DROP_ATTRS = new Set(['content', 'requiredfeatures', 'requiredextensions', 'systemlanguage']);

export interface SvgSanitizeOptions {
  maxKb: number;
  /** Tên vật trong câu lỗi ("Ảnh SVG bản vẽ", "Biểu tượng SVG"). */
  what: string;
  /**
   * `<image>` nhận cả `data:image/svg+xml` (biểu tượng loại thiết bị nằm trong ảnh xem bản vẽ).
   * An toàn vì SVG nạp làm ẢNH chạy ở chế độ tĩnh: không script, không tải gì ra ngoài.
   */
  svgImages?: boolean;
  /** Phần tử bỏ thêm (không giữ trong kết quả) ngoài những thứ ngoài allowlist. */
  dropElements?: ReadonlySet<string>;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Thuộc tính có tiền tố được giữ. Trình duyệt và resvg tra thuộc tính theo URI không gian tên +
 * tên cục bộ, KHÔNG theo chữ tiền tố: `xmlns:x="…xlink"` rồi `x:href` vẫn là xlink:href. Nên chỉ
 * giữ đúng tiền tố `xlink`/`xml` (và chỉ khai báo `xmlns:xlink` trỏ đúng URI xlink), mọi tiền tố
 * khác bỏ hết — `xml:base` cũng bỏ vì nó đổi gốc của mọi đường dẫn tương đối bên dưới.
 */
const PREFIXED_KEPT = new Set(['xlink:href', 'xml:space', 'xml:lang']);

/** Tên cục bộ (sau dấu `:` cuối), chữ thường — bộ đọc HTML cũng hạ chữ tên thuộc tính SVG. */
function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1).toLowerCase();
}

/**
 * Giá trị tải tài nguyên ngoài qua CSS: `url()` không trỏ `#id`, `image-set()`, `@import`. Dấu `\`
 * cạnh dấu `(` là thoát ký tự CSS (`u\72l(` = `url(`) — không bản vẽ thật nào cần, coi là tấn công.
 */
export function cssLoadsExternal(value: string): boolean {
  if (/url\s*\(\s*['"]?(?!#)/i.test(value)) return true;
  if (/image-set\s*\(|@import|expression\s*\(/i.test(value)) return true;
  return value.includes('\\') && value.includes('(');
}

function svgAttrKept(element: string, name: string, value: string, svgImages: boolean): boolean {
  const lower = name.toLowerCase();
  if (lower === 'xmlns') return value === SVG_NS;
  if (lower.startsWith('xmlns:')) return lower === 'xmlns:xlink' && value === XLINK_NS;
  if (lower.includes(':') && !PREFIXED_KEPT.has(lower)) return false;
  if (lower.startsWith('on') || SVG_DROP_ATTRS.has(lower)) return false;
  const flat = squash(value);
  if (BAD_SCHEME.test(flat)) return false;
  if (localName(lower) === 'href') {
    if (element === 'image') return DATA_IMAGE.test(flat) || (svgImages && DATA_SVG.test(flat));
    return flat.startsWith('#');
  }
  // url(#id) trỏ gradient/marker trong tệp thì giữ; url() khác là tải ra ngoài.
  return !cssLoadsExternal(value);
}

export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttr(text: string): string {
  return escapeXmlText(text)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#xa;')
    .replace(/\r/g, '&#xd;')
    .replace(/\t/g, '&#x9;');
}

/**
 * SVG không tin cậy → bản đã làm sạch. Dựng LẠI từ đầu theo allowlist (không sửa tại chỗ chuỗi
 * gốc), nên thứ không nhận ra không lọt qua được.
 */
export function sanitizeSvg(svg: string, options: SvgSanitizeOptions): SanitizeResult {
  const tooBig = sizeReason(svg, options.maxKb, options.what);
  if (tooBig) return { value: null, reason: tooBig };
  if (hasDoctype(svg)) return { value: null, reason: 'SVG có khai báo DOCTYPE/thực thể — không nhận.' };

  const out: string[] = [];
  const open: { name: string; kept: boolean }[] = [];
  let skipDepth = 0;
  let rootSeen = false;
  const svgImages = options.svgImages === true;

  const failure = walkXml(svg, 'Nội dung không phải SVG hợp lệ.', {
    onOpen: (tag) => {
      if (!rootSeen) {
        rootSeen = true;
        if (tag.name !== 'svg') throw new XmlRejected('Nội dung không phải SVG.');
      }
      const kept = skipDepth === 0 && SVG_ELEMENTS.has(tag.name) && !options.dropElements?.has(tag.name);
      if (!kept) {
        if (!tag.isSelfClosing) skipDepth += 1;
        if (!tag.isSelfClosing) open.push({ name: tag.name, kept: false });
        return;
      }
      const attrs = Object.entries(tag.attributes)
        .filter(([name, value]) => svgAttrKept(tag.name, name, value, svgImages))
        .map(([name, value]) => ` ${name}="${escapeXmlAttr(value)}"`)
        .join('');
      out.push(`<${tag.name}${attrs}${tag.isSelfClosing ? '/>' : '>'}`);
      if (!tag.isSelfClosing) open.push({ name: tag.name, kept: true });
    },
    onClose: (tag) => {
      if (tag.isSelfClosing) return;
      const top = open.pop();
      if (!top) return;
      if (top.kept) out.push(`</${top.name}>`);
      else skipDepth -= 1;
    },
    onText: (text) => {
      if (skipDepth === 0) out.push(escapeXmlText(text));
    },
  });
  if (failure) return { value: null, reason: failure };
  if (!rootSeen) return { value: null, reason: 'Nội dung không phải SVG.' };
  return { value: out.join(''), reason: null };
}

/* ------------------------------------------------------- biểu tượng tải lên --- */

/** Chữ phụ của tệp vẽ (tiêu đề, mô tả) không cần cho một biểu tượng và hay mang URL. */
const ICON_DROP = new Set(['title', 'desc', 'image', 'foreignObject']);

/**
 * Thứ trong biểu tượng tải lên làm cả tệp bị TỪ CHỐI thay vì gỡ lặng lẽ: đây là dấu hiệu tệp
 * được chế để tấn công (hoặc xuất từ công cụ lạ), SA cần biết tệp mình chọn có vấn đề.
 */
function iconDangerReason(svg: string): string | null {
  let reason: string | null = null;
  const failure = walkXml(svg, 'Tệp không phải SVG hợp lệ.', {
    onOpen: (tag) => {
      const local = tag.name.split(':').pop()!.toLowerCase();
      if (local === 'script') throw new XmlRejected('Biểu tượng có <script> — không nhận.');
      for (const [name, value] of Object.entries(tag.attributes)) {
        const lower = name.toLowerCase();
        if (lower.startsWith('on')) throw new XmlRejected(`Biểu tượng có thuộc tính sự kiện (${name}) — không nhận.`);
        const flat = squash(value);
        if (BAD_SCHEME.test(flat)) throw new XmlRejected('Biểu tượng có javascript:/vbscript: — không nhận.');
        if (localName(lower) === 'href' && !flat.startsWith('#') && !DATA_IMAGE.test(flat)) {
          throw new XmlRejected('Biểu tượng trỏ ra ngoài (href) — chỉ nhận SVG tự chứa.');
        }
        if (lower === 'xml:base') throw new XmlRejected('Biểu tượng có xml:base — không nhận.');
        if (cssLoadsExternal(value)) throw new XmlRejected('Biểu tượng tải tài nguyên ngoài (url()) — không nhận.');
      }
    },
  });
  if (failure) reason = failure;
  return reason;
}

/**
 * SVG biểu tượng loại thiết bị do SA tải lên → bản đã lọc để cất, hoặc lý do từ chối.
 *
 * Script, `on*`, `javascript:`, `href`/`url()` ra ngoài, DOCTYPE/thực thể → TỪ CHỐI cả tệp.
 * Phần còn lại qua đúng allowlist của ảnh xem bản vẽ; `foreignObject`, `<style>`, metadata của
 * Inkscape/Illustrator bị gỡ. Kết quả luôn có `xmlns` (thiếu nó thì trình duyệt không vẽ SVG
 * làm ảnh) và không còn chữ nào giống URL — cổng bản vẽ soi đúng điều đó trên ảnh `data:` nhúng.
 */
export function sanitizeIconSvg(svg: string, options: { maxKb: number }): SanitizeResult {
  const tooBig = sizeReason(svg, options.maxKb, 'Biểu tượng SVG');
  if (tooBig) return { value: null, reason: tooBig };
  if (hasDoctype(svg)) return { value: null, reason: 'Biểu tượng có khai báo DOCTYPE/thực thể — không nhận.' };
  const danger = iconDangerReason(svg);
  if (danger) return { value: null, reason: danger };
  const clean = sanitizeSvg(svg, { maxKb: options.maxKb, what: 'Biểu tượng SVG', dropElements: ICON_DROP });
  if (clean.reason || !clean.value) return { value: null, reason: clean.reason ?? 'Biểu tượng rỗng.' };
  let value = clean.value;
  if (!/^<svg\b[^>]*\sxmlns="/.test(value)) value = value.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  if (svgTextHasUrl(value)) return { value: null, reason: 'Biểu tượng có chữ trông như đường dẫn (http:, //) — gỡ ra rồi tải lại.' };
  if (!/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/.test(value)) {
    return { value: null, reason: 'Biểu tượng không có hình nào để vẽ.' };
  }
  return { value, reason: null };
}

/* ------------------------------------------------------- chặn cuối trước resvg --- */

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
/** SVG lồng trong `data:` cũng được resvg vẽ (và tự tải ảnh trong nó) — soi lồng tối đa từng này tầng. */
const MAX_NESTED_SVG = 3;

function decodeDataSvg(href: string): string | null {
  const comma = href.indexOf(',');
  if (comma < 0) return null;
  const head = href.slice(0, comma);
  const body = href.slice(comma + 1);
  try {
    return /;base64$/i.test(head) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
  } catch {
    return null;
  }
}

/**
 * Lý do KHÔNG được đưa SVG này cho resvg, hoặc `null`. resvg (2.x) không có tuỳ chọn tắt tải tài
 * nguyên: `<image href="/đường/tuyệt/đối">` nó đọc thẳng từ đĩa của container api (đã kiểm), nên
 * một href lọt cổng là lộ tệp vào ảnh xuất. Đây là lưới thứ hai sau `sanitizeSvg`, đọc bằng
 * parser CÓ phân giải không gian tên (đúng cách resvg đọc): mọi thuộc tính tên cục bộ `href` ở bất
 * kỳ không gian tên nào chỉ được trỏ `#id` hoặc ảnh `data:`; SVG lồng trong `data:` soi đệ quy.
 */
export function svgRenderReason(svg: string, depth = 0): string | null {
  if (hasDoctype(svg)) return 'SVG có khai báo DOCTYPE/thực thể.';
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', () => {
    throw new XmlRejected('SVG không hợp lệ (cú pháp hoặc tiền tố chưa khai báo).');
  });
  parser.on('opentag', (tag) => {
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === XML_NS && attr.local === 'base') throw new XmlRejected('SVG có xml:base.');
      if (attr.local.toLowerCase() !== 'href') continue;
      const flat = squash(attr.value);
      if (flat.startsWith('#') || DATA_IMAGE.test(flat)) continue;
      if (DATA_SVG.test(flat) && depth < MAX_NESTED_SVG) {
        const inner = decodeDataSvg(flat);
        const innerReason = inner === null ? 'SVG lồng không giải mã được.' : svgRenderReason(inner, depth + 1);
        if (innerReason) throw new XmlRejected(innerReason);
        continue;
      }
      throw new XmlRejected(`SVG trỏ tài nguyên ngoài (${attr.name}).`);
    }
  });
  try {
    parser.write(svg).close();
  } catch (error) {
    return error instanceof XmlRejected ? error.message : 'SVG không hợp lệ.';
  }
  return null;
}

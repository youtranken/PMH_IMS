import { SaxesParser, type SaxesTagPlain } from 'saxes';

/**
 * Cổng kiểm XML/SVG bản vẽ (AD-17) — hàm THUẦN, test bảng dữ liệu ở `diagram-gate.spec.ts`.
 *
 * XML bản vẽ là dữ liệu KHÔNG TIN CẬY: nó đi từ iframe draw.io (chạy được mã của bản vẽ) qua tay
 * trình duyệt rồi mới tới đây, nên ai gọi thẳng API cũng gửi được bất cứ thứ gì. Thứ qua cổng này
 * sau đó được nạp lại vào trình vẽ, và SVG được chèn vào DOM của trang IMS ở chế độ xem — một
 * nhãn `<img onerror>` lọt qua là script chạy bằng phiên của người xem.
 *
 * Vì vậy cổng chọn ALLOWLIST (thẻ, thuộc tính nhãn, nguồn ảnh) chứ không denylist, và từ chối cả
 * tệp thay vì sửa lặng lẽ: người vẽ cần biết bản của mình có thứ không được lưu.
 *
 * Parser là `saxes`: không đọc DTD, không mở thực thể ngoài; gặp DOCTYPE là từ chối luôn.
 */

export interface DiagramXmlLimits {
  /** `diagram.xml_max_kb` */
  xmlMaxKb: number;
  /** `diagram.max_cells` */
  maxCells: number;
}

export interface DiagramSvgLimits {
  /** `diagram.svg_max_kb` */
  svgMaxKb: number;
}

/** Một hình dạng trả về: `reason` khác `null` là từ chối (câu tiếng Việt cho người dùng). */
export interface GateResult {
  reason: string | null;
}

export interface SanitizeResult {
  value: string | null;
  reason: string | null;
}

/** Thẻ có trong tệp draw.io không nén. Thẻ nào khác (script, iframe, svg…) là từ chối. */
const XML_ELEMENTS = new Set([
  'mxfile',
  'diagram',
  'mxGraphModel',
  'root',
  'mxCell',
  'mxGeometry',
  'mxPoint',
  'mxRectangle',
  'Array',
  'Object',
  'UserObject',
  'object',
]);

/*
 * Thuộc tính có thể thành NHÃN HTML: `value` của ô, và với ô dữ liệu (`UserObject`/`object`)
 * thì MỌI thuộc tính — `placeholders=1` cho nhãn chèn `%tên%` của thuộc tính bất kỳ vào HTML.
 */
const DATA_ELEMENTS = new Set(['UserObject', 'object']);

const BAD_SCHEME = /(?:java|vb)script:|data:text\/html/i;

/** Bỏ khoảng trắng/ký tự điều khiển mà trình duyệt cũng bỏ khi đọc URL (`java\tscript:`). */
function squash(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u0000-\u001f]+/g, '');
}

function sizeReason(text: string, maxKb: number, what: string): string | null {
  return Buffer.byteLength(text, 'utf8') > maxKb * 1024 ? `${what} vượt trần ${maxKb} KB.` : null;
}

function hasDoctype(text: string): boolean {
  return /<!DOCTYPE|<!ENTITY/i.test(text);
}

class Rejected extends Error {}

/**
 * Chạy parser, gọi `onOpen`/`onClose`/`onText` theo thứ tự tài liệu. Ném `Rejected` từ callback
 * để dừng với lý do; lỗi cú pháp thành `syntaxReason`.
 */
function walk(
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
    throw new Rejected(syntaxReason);
  });
  parser.on('doctype', () => {
    throw new Rejected('Tệp có khai báo DOCTYPE/thực thể — không nhận.');
  });
  parser.on('processinginstruction', (pi) => {
    if (pi.target.toLowerCase() !== 'xml') throw new Rejected(syntaxReason);
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
    failure = error instanceof Rejected ? error.message : syntaxReason;
  }
  return failure;
}

/* ----------------------------------------------------------------- nhãn HTML -- */

const LABEL_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'br', 'hr', 'div', 'span', 'p',
  'font', 'ul', 'ol', 'li', 'pre', 'code', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

const LABEL_ATTRS = new Set(['style', 'color', 'face', 'size', 'align', 'colspan', 'rowspan', 'dir']);

/** CSS trong nhãn được đổi màu/chữ/căn lề; tải tài nguyên hay chạy biểu thức thì không. */
const BAD_CSS = /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|javascript:/i;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Giải mã thực thể HTML; còn sót thực thể tên lạ thì trả `null` (không đoán được trình duyệt đọc ra gì). */
function decodeHtml(value: string): string | null {
  let unknown = false;
  const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named === undefined) unknown = true;
    return named ?? match;
  });
  return unknown ? null : decoded;
}

const TAG_AT = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/y;
const ATTR_AT = /[\s/]*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;

/**
 * Kiểm một nhãn HTML theo allowlist thẻ định dạng. Trả câu lý do, hoặc `null` nếu nhận.
 *
 * Không dựng lại cây HTML: mọi `<` theo sau là chữ cái, `/`, `!`, `?` phải là MỘT thẻ đầy đủ trong
 * allowlist với thuộc tính trong allowlist. `<` theo sau khoảng trắng/chữ số là chữ thường
 * ("a < b"), trình duyệt cũng đọc nó là chữ.
 */
export function checkLabelHtml(html: string): string | null {
  for (let at = html.indexOf('<'); at !== -1; at = html.indexOf('<', at + 1)) {
    const next = html[at + 1] ?? '';
    if (!/[a-zA-Z/!?]/.test(next)) continue;
    TAG_AT.lastIndex = at;
    const tag = TAG_AT.exec(html);
    if (!tag) return 'Nhãn có thẻ HTML không đọc được.';
    const name = tag[2].toLowerCase();
    if (!LABEL_TAGS.has(name)) return `Nhãn có thẻ HTML không được phép: <${name}>.`;
    const attrReason = checkLabelAttrs(name, tag[3], tag[1] === '/');
    if (attrReason) return attrReason;
    at = TAG_AT.lastIndex - 1;
  }
  return null;
}

function checkLabelAttrs(tagName: string, rest: string, closing: boolean): string | null {
  let pos = 0;
  while (pos < rest.length) {
    if (/^[\s/]*$/.test(rest.slice(pos))) return null;
    if (closing) return `Nhãn có thẻ đóng </${tagName}> kèm thuộc tính.`;
    ATTR_AT.lastIndex = pos;
    const attr = ATTR_AT.exec(rest);
    if (!attr || ATTR_AT.lastIndex === pos) return `Nhãn có thẻ <${tagName}> không đọc được.`;
    pos = ATTR_AT.lastIndex;
    const name = attr[1].toLowerCase();
    if (!LABEL_ATTRS.has(name)) return `Nhãn có thuộc tính không được phép: ${name} trên <${tagName}>.`;
    const decoded = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? '');
    if (decoded === null) return `Nhãn có ký tự mã hoá lạ trong thuộc tính ${name}.`;
    if (BAD_CSS.test(decoded) || BAD_SCHEME.test(squash(decoded))) {
      return `Nhãn có ${name} tải tài nguyên ngoài hoặc chạy mã.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------- ảnh ----- */

/*
 * Nguồn ảnh của ô: ảnh nhúng raster, hoặc ảnh có sẵn trong thư mục draw.io tự host (đường tương
 * đối như `img/lib/...`, trình vẽ tải từ `/drawio/`). URL tuyệt đối, `//host`, `..` đều là trỏ ra
 * ngoài: trình vẽ/trình xem sẽ tải nó bằng máy người xem.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif)[;,]/i;
const DATA_SVG = /^data:image\/svg\+xml[;,]/i;
const BUILTIN_IMAGE = /^(?:img|images|stencils|shapes|mxgraph)\/[A-Za-z0-9_./%-]+$/;

function imageSourceOk(src: string): boolean {
  const value = squash(src);
  if (value === '') return true;
  if (DATA_IMAGE.test(value)) return true;
  // SVG nhúng làm ẢNH (thẻ <image>) không chạy script được; vẫn cấm SVG mang URL ngoài.
  if (DATA_SVG.test(value)) return !/https?:|\/\//i.test(decodeURIComponentSafe(value));
  return BUILTIN_IMAGE.test(value) && !value.includes('..');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Giá trị `image=` trong chuỗi style draw.io (`k=v;k=v;`). Ảnh data: có thể chứa `;base64`. */
function styleImages(style: string): string[] {
  const out: string[] = [];
  const re = /(?:^|;)\s*image\s*=\s*([^;]*(?:;base64,[^;]*)?)/gi;
  for (let m = re.exec(style); m; m = re.exec(style)) out.push(m[1]);
  return out;
}

/* --------------------------------------------------------------- XML bản vẽ -- */

/**
 * Cổng của mọi lần lưu: cỡ, cú pháp, đúng MỘT trang không nén, allowlist thẻ, không `on*`/`link`/
 * `javascript:`, nhãn HTML theo allowlist, ảnh không trỏ ra ngoài, số ô trong trần.
 */
export function checkDiagramXml(xml: string, limits: DiagramXmlLimits): GateResult {
  const tooBig = sizeReason(xml, limits.xmlMaxKb, 'Bản vẽ');
  if (tooBig) return { reason: tooBig };
  if (hasDoctype(xml)) return { reason: 'Bản vẽ có khai báo DOCTYPE/thực thể — không nhận.' };

  const stack: string[] = [];
  let pages = 0;
  let cells = 0;
  let pageHasModel = false;
  let pageHasText = false;
  let rootName: string | null = null;

  const failure = walk(xml, 'Nội dung không phải XML hợp lệ.', {
    onOpen: (tag) => {
      if (rootName === null) {
        rootName = tag.name;
        if (tag.name !== 'mxfile') throw new Rejected('Nội dung không phải tệp draw.io.');
      }
      if (!XML_ELEMENTS.has(tag.name)) throw new Rejected(`Bản vẽ có thẻ không được phép: <${tag.name}>.`);
      if (tag.name === 'diagram') {
        pages += 1;
        pageHasModel = false;
        pageHasText = false;
      }
      if (tag.name === 'mxGraphModel' && stack[stack.length - 1] === 'diagram') pageHasModel = true;
      if (tag.name === 'mxCell') cells += 1;
      const reason = checkAttributes(tag);
      if (reason) throw new Rejected(reason);
      if (!tag.isSelfClosing) stack.push(tag.name);
    },
    onClose: (tag) => {
      if (tag.name === 'diagram' && (pageHasText || !pageHasModel)) {
        throw new Rejected('Bản vẽ đang ở dạng nén — IMS chỉ nhận XML không nén (compressXml: false).');
      }
      if (!tag.isSelfClosing) stack.pop();
    },
    onText: (text) => {
      if (stack[stack.length - 1] === 'diagram' && text.trim() !== '') pageHasText = true;
    },
  });
  if (failure) return { reason: failure };
  if (rootName === null) return { reason: 'Nội dung không phải tệp draw.io.' };
  if (pages !== 1) return { reason: `Bản vẽ phải có đúng một trang (đang có ${pages}).` };
  if (cells > limits.maxCells) return { reason: `Bản vẽ có ${cells} ô, vượt trần ${limits.maxCells} ô.` };
  return { reason: null };
}

function checkAttributes(tag: SaxesTagPlain): string | null {
  const isData = DATA_ELEMENTS.has(tag.name);
  for (const [name, value] of Object.entries(tag.attributes)) {
    if (/^on/i.test(name)) return `Bản vẽ có thuộc tính sự kiện (on*): ${name}.`;
    if (isData && name === 'link') {
      return 'Bản vẽ có liên kết trên hình (thuộc tính link) — IMS không nhận liên kết trong bản vẽ.';
    }
    if (BAD_SCHEME.test(squash(value))) return `Bản vẽ có javascript:/vbscript:/data:text/html trong ${name}.`;
    if (name === 'style') {
      if (styleImages(value).some((src) => !imageSourceOk(src))) return 'Ảnh trong bản vẽ trỏ ra ngoài — chỉ nhận ảnh nhúng.';
    }
    if (name === 'image' && !imageSourceOk(value)) return 'Ảnh trong bản vẽ trỏ ra ngoài — chỉ nhận ảnh nhúng.';
    if (name === 'backgroundImage' && backgroundImageReason(value)) return backgroundImageReason(value);
    const label = (tag.name === 'mxCell' && name === 'value') || name === 'tooltip' || (isData && name !== 'id');
    if (label && value.includes('<')) {
      const reason = checkLabelHtml(value);
      if (reason) return reason;
    }
  }
  return null;
}

function backgroundImageReason(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { src?: unknown };
    if (typeof parsed.src === 'string' && imageSourceOk(parsed.src)) return null;
  } catch {
    /* không đọc được thì coi như trỏ ra ngoài */
  }
  return 'Ảnh trong bản vẽ trỏ ra ngoài — chỉ nhận ảnh nhúng.';
}

/* -------------------------------------------------------------- SVG để xem --- */

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

function svgAttrKept(element: string, name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || SVG_DROP_ATTRS.has(lower)) return false;
  const flat = squash(value);
  if (BAD_SCHEME.test(flat)) return false;
  if (lower === 'href' || lower === 'xlink:href') {
    if (element === 'image') return DATA_IMAGE.test(flat);
    return flat.startsWith('#');
  }
  // url(#id) trỏ gradient/marker trong tệp thì giữ; url() khác là tải ra ngoài.
  if (/url\s*\(/i.test(value) && /url\s*\(\s*['"]?(?!#)/i.test(value)) return false;
  if (/@import|expression\s*\(/i.test(value)) return false;
  return true;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/**
 * SVG do trình vẽ xuất lúc lưu → bản đã làm sạch để chèn vào DOM trình xem. Dựng LẠI từ đầu
 * theo allowlist (không sửa tại chỗ chuỗi gốc), nên thứ không nhận ra không lọt qua được.
 */
export function sanitizeDiagramSvg(svg: string, limits: DiagramSvgLimits): SanitizeResult {
  const tooBig = sizeReason(svg, limits.svgMaxKb, 'Ảnh SVG bản vẽ');
  if (tooBig) return { value: null, reason: tooBig };
  if (hasDoctype(svg)) return { value: null, reason: 'SVG có khai báo DOCTYPE/thực thể — không nhận.' };

  const out: string[] = [];
  const open: { name: string; kept: boolean }[] = [];
  let skipDepth = 0;
  let rootSeen = false;

  const failure = walk(svg, 'Nội dung không phải SVG hợp lệ.', {
    onOpen: (tag) => {
      if (!rootSeen) {
        rootSeen = true;
        if (tag.name !== 'svg') throw new Rejected('Nội dung không phải SVG.');
      }
      const kept = skipDepth === 0 && SVG_ELEMENTS.has(tag.name);
      if (!kept) {
        if (!tag.isSelfClosing) skipDepth += 1;
        if (!tag.isSelfClosing) open.push({ name: tag.name, kept: false });
        return;
      }
      const attrs = Object.entries(tag.attributes)
        .filter(([name, value]) => svgAttrKept(tag.name, name, value))
        .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
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
      if (skipDepth === 0) out.push(escapeText(text));
    },
  });
  if (failure) return { value: null, reason: failure };
  if (!rootSeen) return { value: null, reason: 'Nội dung không phải SVG.' };
  return { value: out.join(''), reason: null };
}

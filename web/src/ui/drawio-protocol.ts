import { formatDateTime } from '@/lib/format';

/**
 * Giao thức nhúng draw.io (AD-17) — hàm THUẦN, test bảng dữ liệu ở `drawio-protocol.test.ts`.
 * Màn nào cũng gửi/nhận qua `drawio-frame.tsx`, không tự postMessage; màn chỉ dùng kiểu sự kiện/
 * lệnh và hàm đọc dữ liệu sự kiện (`exportedSvgText`) ở đây.
 *
 * draw.io chạy ở `/drawio/` trong iframe sandbox nguồn gốc mờ; hai bên chỉ nói chuyện bằng
 * postMessage chuỗi JSON (`proto=json`): draw.io gửi `event`, IMS gửi `action`.
 */

export const DRAWIO_PATH = '/drawio/';

/*
 * Chỉ `allow-scripts`: thiếu `allow-same-origin` nên khung chạy ở nguồn gốc mờ — không đọc được
 * cookie/DOM/localStorage của IMS, gọi /api không kèm phiên. Không `allow-downloads` (xuất file đi
 * qua lệnh `export` rồi qua server), không `allow-modals` (hộp thoại của draw.io là DOM của nó),
 * không `allow-popups`/`allow-top-navigation`. Đủ cho draw.io 31.6.1 chạy nhúng — đã kiểm bằng
 * trình duyệt thật, ghi ở ARCHITECTURE-SPINE AD-17.
 */
export const DRAWIO_SANDBOX = 'allow-scripts';

const COMMON_PARAMS: Record<string, string> = {
  embed: '1',
  proto: 'json',
  spin: '1',
  lang: 'vi',
  stealth: '1',
  offline: '1',
  configure: '1',
  plugins: '0',
  pages: '0',
  pwa: '0',
  // Tắt từng nguồn đám mây: Google Drive, OneDrive, Dropbox, GitHub, GitLab, Trello.
  gapi: '0',
  od: '0',
  db: '0',
  gh: '0',
  gl: '0',
  tr: '0',
};

export type DrawioMode = 'edit' | 'view';

/*
 * Thư viện hình mở sẵn ở bảng hình bên trái — id theo `Sidebar.prototype.configuration` của draw.io
 * 31.6.1 (id lạ thì draw.io lặng lẽ bỏ qua). Gửi cả qua URL `libs`: `defaultLibraries` của
 * configure chỉ là mặc định khi draw.io chưa có lựa chọn lưu sẵn, còn `libs` luôn được cộng vào.
 */
const DRAWIO_LIBRARIES = 'general;network;rack';

export function drawioUrl(mode: DrawioMode): string {
  const params = new URLSearchParams(COMMON_PARAMS);
  if (mode === 'edit') {
    params.set('noExitBtn', '1');
    params.set('saveAndExit', '0');
    params.set('libs', DRAWIO_LIBRARIES);
  } else {
    params.set('chrome', '0');
  }
  return `${DRAWIO_PATH}?${params.toString()}`;
}

export interface DrawioBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DrawioEventName =
  | 'configure'
  | 'init'
  | 'load'
  | 'autosave'
  | 'save'
  | 'export'
  | 'exit'
  | 'openLink'
  | 'patch';

/**
 * Một tin của trình vẽ, đã kiểm hình dạng. MỘT hình dạng cho mọi sự kiện (web không bật
 * `strict`, union phân biệt không thu hẹp được) — trường nào có là do `parseDrawioEvent` bảo đảm
 * theo từng `event`.
 */
export interface DrawioEvent {
  event: DrawioEventName;
  xml?: string;
  data?: string;
  format?: string;
  href?: string;
  exit?: boolean;
  modified?: boolean;
  error?: string;
  currentPage?: number;
  modelBounds?: DrawioBounds;
}

/** Trường bắt buộc theo sự kiện — thiếu là tin giả/hỏng, bỏ qua. */
const REQUIRED: Record<DrawioEventName, (keyof DrawioEvent)[]> = {
  configure: [],
  init: [],
  load: [],
  autosave: ['xml'],
  save: ['xml'],
  export: ['data'],
  exit: [],
  openLink: ['href'],
  patch: [],
};

/** Xuất định dạng `xml` trả cả tệp ở `xml` chứ không ở `data` — mọi định dạng khác bắt buộc `data`. */
function requiredOf(event: DrawioEvent): (keyof DrawioEvent)[] {
  return event.event === 'export' && event.format === 'xml' ? ['xml'] : REQUIRED[event.event];
}

const STRING_FIELDS = ['xml', 'data', 'format', 'href', 'error'] as const;
const BOOL_FIELDS = ['exit', 'modified'] as const;

function isBounds(value: unknown): value is DrawioBounds {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number');
}

/**
 * Tin từ khung → `DrawioEvent`, hoặc `null` cho mọi thứ khác (không ném). Chép lại TỪNG trường
 * đã kiểm kiểu thay vì trả nguyên object: thuộc tính lạ trong tin không đi tiếp vào màn.
 */
export function parseDrawioEvent(data: unknown): DrawioEvent | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const name = raw.event;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(REQUIRED, name)) return null;
  const out: DrawioEvent = { event: name as DrawioEventName };
  for (const key of STRING_FIELDS) {
    // `null` = vắng: draw.io gửi `load` của bản vẽ trống với `xml: null` — bỏ cả tin là màn không
    // bao giờ biết trình vẽ đã nạp. Trường bắt buộc vẫn bị kiểm ở `REQUIRED` bên dưới.
    if (raw[key] === undefined || raw[key] === null) continue;
    if (typeof raw[key] !== 'string') {
      if (key === 'error') continue;
      return null;
    }
    out[key] = raw[key] as string;
  }
  for (const key of BOOL_FIELDS) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  if (typeof raw.currentPage === 'number') out.currentPage = raw.currentPage;
  if (raw.modelBounds !== undefined) {
    if (!isBounds(raw.modelBounds)) return null;
    const b = raw.modelBounds;
    out.modelBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  if (requiredOf(out).some((key) => out[key] === undefined)) return null;
  return out;
}

export interface DrawioConfig {
  [key: string]: unknown;
}

export type DrawioExportFormat = 'xmlsvg' | 'svg' | 'xmlpng' | 'png' | 'xml';

/**
 * Lệnh IMS gửi trình vẽ. `merge` cho việc chèn của các màn sau; `export` định dạng `xml` + `patch`
 * để chèn một hình mà không đụng phần người vẽ chưa lưu; `save` bấm nút Lưu của draw.io (nó trả
 * `event: save`).
 *
 * Không có `getDiff`: bản vẽ một trang thì draw.io trả mô hình trần (`<mxGraphModel>`) không kèm
 * `<diagram id>`, nên không biết trang nào để `patch`. `export` `xml` luôn trả cả tệp.
 */
export type DrawioCommand =
  | { action: 'load'; xml: string; autosave?: boolean; title?: string }
  | { action: 'merge'; xml: string }
  | { action: 'export'; format: DrawioExportFormat }
  | { action: 'configure'; config: DrawioConfig }
  | { action: 'patch'; patch: unknown }
  | { action: 'save' };

export function serializeDrawioCommand(command: DrawioCommand): string {
  switch (command.action) {
    case 'load':
      return JSON.stringify({
        action: 'load',
        xml: command.xml,
        autosave: command.autosave ? 1 : 0,
        ...(command.title ? { title: command.title } : {}),
      });
    case 'save':
      return JSON.stringify({ action: 'invokeAction', actionName: 'save' });
    default:
      return JSON.stringify(command);
  }
}

/** Màu CSS đã tính (`#rgb`, `#rrggbb`, `rgb()`/`rgba()`) → mã draw.io viết hoa không `#`. */
export function cssColorToDrawio(value: string): string | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return digits.toUpperCase();
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(text);
  if (rgb) {
    return rgb
      .slice(1, 4)
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return null;
}

/**
 * Cấu hình đẩy cho sự kiện `configure`. XML không nén để server đọc được ô (cổng kiểm, chỉ mục ô);
 * tắt thư viện tự thêm (tải từ URL) và URL xuất; bảng màu là các màu dây đọc từ token lúc chạy —
 * mã nguồn không chứa mã màu.
 */
export function buildDrawioConfig(wireColors: string[]): DrawioConfig {
  return {
    compressXml: false,
    defaultLibraries: DRAWIO_LIBRARIES,
    enableCustomLibraries: false,
    enableExportUrl: false,
    suppressNewWindows: true,
    presetColors: wireColors.map(cssColorToDrawio).filter((c): c is string => c !== null),
  };
}

/**
 * Ô màu IMS trên nét dây của kho (`imsPaint=cable-<n>|warn|danger`, server đặt lúc hydrate — AD-18)
 * → `strokeColor`/`fontColor` theo bảng màu đọc từ token lúc chạy (`palette`: ô màu → mã draw.io
 * viết hoa không `#`). Màu cũ trong style bị thay chứ không cộng dồn; ô màu lạ thì để nguyên —
 * không đoán màu.
 */
export function paintImsStyle(style: string, palette: Record<string, string>): string {
  const match = /(?:^|;)imsPaint=([a-z0-9-]+)/.exec(style);
  const color = match ? palette[match[1]] : undefined;
  if (!color) return style;
  const kept = style
    .split(';')
    .filter((token) => token !== '' && !/^(strokeColor|fontColor)=/.test(token));
  return `${kept.join(';')};strokeColor=#${color};fontColor=#${color};`;
}

/** `paintImsStyle` trên mọi thuộc tính `style="…"` của một XML (chỉ đụng style có ô màu IMS). */
export function paintImsXml(xml: string, palette: Record<string, string>): string {
  return xml.replace(/ style="([^"]*imsPaint=[^"]*)"/g, (_all, style: string) => ` style="${paintImsStyle(style, palette)}"`);
}

/** Dòng watermark "tên · email · giờ:phút" (giờ Việt Nam). */
export function watermarkText(viewer: { fullName: string; email: string }, now: Date): string {
  return `${viewer.fullName} · ${viewer.email} · ${formatDateTime(now).slice(-5)}`;
}

/** DOCTYPE SVG 1.1 chuẩn (không khai báo thực thể) mà draw.io gắn đầu ảnh xuất. */
const STANDARD_SVG_HEAD = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!DOCTYPE svg PUBLIC "[^"[\]]*" "[^"[\]]*">\s*)?/;

/**
 * Dữ liệu sự kiện `export` (định dạng `svg`) → chữ SVG để gửi server cùng XML khi lưu.
 *
 * Chỉ bỏ phần đầu tệp CHUẨN (khai báo XML + DOCTYPE SVG 1.1 không có thực thể): cổng server từ
 * chối mọi DOCTYPE, và bỏ rộng hơn ở đây là giấu một DOCTYPE lạ khỏi cổng đó. Kết quả vẫn là dữ
 * liệu KHÔNG tin cậy — server làm sạch nó trước khi lưu (AD-17).
 */
export function exportedSvgText(data: string): { value: string | null; reason: string | null } {
  let text = data;
  if (data.startsWith('data:')) {
    const match = /^data:image\/svg\+xml(;base64)?,([\s\S]*)$/.exec(data);
    if (!match) return { value: null, reason: 'not-svg' };
    try {
      text = match[1]
        ? new TextDecoder().decode(Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)))
        : decodeURIComponent(match[2]);
    } catch {
      return { value: null, reason: 'decode' };
    }
  }
  const body = text.replace(STANDARD_SVG_HEAD, '');
  if (!body.trim()) return { value: null, reason: 'empty' };
  return { value: body, reason: null };
}

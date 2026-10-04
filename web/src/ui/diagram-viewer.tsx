import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DiagramWatermark } from './diagram-watermark';
import { Popover } from './popover';

export interface Size {
  width: number;
  height: number;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

const BLOCKED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'style', 'a', 'animate', 'set', 'handler', 'listener']);
/* SVG nạp làm ẢNH (`<image>`) chạy chế độ tĩnh — không script, không tải ngoài: biểu tượng SVG
   riêng của loại thiết bị nằm trong ảnh xem dưới dạng này. */
const SAFE_IMAGE = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]/i;
/** Dời con trỏ quá ngần này (px) giữa lúc nhấn và thả là kéo khung, không phải bấm ô. */
const CLICK_SLOP = 5;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
/**
 * Dưới mức thu phóng này nhãn cổng trên nét dây bị ẩn: chữ 11px thu còn dưới 7px chỉ thành vệt
 * xám chồng lên nhau, che máy và dây — nhất là trên điện thoại khi cả bản vẽ vừa một màn. Đây là
 * ngưỡng hiển thị của trình xem (đọc được hay không), không phải tham số nghiệp vụ.
 */
const LOD_NEAR_SCALE = 0.6;

/** Mức chi tiết theo mức thu phóng: `far` ẩn nhãn cổng (CSS theo `data-lod`). */
export function detailLevel(scale: number): 'near' | 'far' {
  return scale < LOD_NEAR_SCALE ? 'far' : 'near';
}

/**
 * Phóng hai ngón: điểm nội dung nằm dưới trung điểm hai ngón lúc chạm (`a0`, `b0`) đi theo trung
 * điểm hiện tại (`a1`, `b1`), mức thu phóng nhân theo tỉ lệ khoảng cách hai ngón — cảm giác "nắm
 * lấy bản vẽ" như xem ảnh trên điện thoại.
 */
export function pinchView(start: ViewTransform, a0: ViewerPoint, b0: ViewerPoint, a1: ViewerPoint, b1: ViewerPoint): ViewTransform {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = d0 > 0 ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, (start.scale * d1) / d0)) : start.scale;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const content = { x: (m0.x - start.x) / start.scale, y: (m0.y - start.y) / start.scale };
  return { scale, x: m1.x - content.x * scale, y: m1.y - content.y * scale };
}

/**
 * Một lớp bật/tắt được của trình xem: lớp draw.io, nhóm theo loại thiết bị, nhóm theo loại dây.
 * Màn dựng danh sách ô của mỗi lớp (từ chỉ mục ô, AD-18); trình xem chỉ ẩn/hiện theo `data-cell-id`.
 * Lớp "trạng thái sống" (FR-049) sẽ là một `group` nữa — xem `docs/THIET-KE-TRANG-THAI-SONG.md`.
 */
export interface ViewerLayer {
  key: string;
  label: string;
  group: 'drawio' | 'deviceType' | 'cableType';
  cellIds: string[];
}

const LAYER_GROUPS: ViewerLayer['group'][] = ['drawio', 'deviceType', 'cableType'];
const LAYER_GROUP_KEY: Record<ViewerLayer['group'], string> = {
  drawio: 'diagramViewer.layerGroupDrawio',
  deviceType: 'diagramViewer.layerGroupDeviceType',
  cableType: 'diagramViewer.layerGroupCableType',
};

/** Ô bị ẩn = ô thuộc ít nhất một lớp đang tắt. */
export function hiddenByLayers(layers: ViewerLayer[], hidden: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const layer of layers) if (hidden.has(layer.key)) for (const id of layer.cellIds) out.add(id);
  return out;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/**
 * Một thuộc tính có an toàn không — tra theo URI không gian tên + tên cục bộ như trình duyệt, KHÔNG
 * theo chữ tiền tố (`xmlns:x="…xlink"` rồi `x:href` vẫn là xlink:href). Chỉ nhận: thuộc tính không
 * không gian tên, `xlink:href`, `xml:space`/`xml:lang`, và khai báo trỏ đúng SVG/xlink — đúng tập
 * cổng server giữ lại. `xml:base` đổi gốc đường dẫn nên bị từ chối cùng mọi không gian tên lạ.
 */
function attrSafe(element: string, attr: Attr): boolean {
  const local = attr.localName.toLowerCase();
  const ns = attr.namespaceURI;
  if (ns === XMLNS_NS) return attr.value === SVG_NS || attr.value === XLINK_NS;
  if (ns === XML_NS) return local === 'space' || local === 'lang';
  if (ns !== null && !(ns === XLINK_NS && local === 'href')) return false;
  const value = attr.value.replace(/\s+/g, '');
  if (local.startsWith('on') || /(?:java|vb)script:/i.test(value)) return false;
  if (local === 'href') return value.startsWith('#') || (element === 'image' && SAFE_IMAGE.test(value));
  return !/url\(['"]?(?!#)|image-set\(|@import/i.test(value) && !(value.includes('\\') && value.includes('('));
}

/**
 * SVG bản vẽ → phần tử để chèn vào DOM trình xem, hoặc lý do từ chối.
 *
 * Server đã làm sạch SVG lúc lưu (`diagram-gate.ts`, AD-17) và trình xem chỉ nhận SVG từ API, nên
 * đây là lưới thứ HAI: gặp thứ server lẽ ra đã bỏ thì TỪ CHỐI cả bản (không gỡ lặng lẽ) — có nghĩa
 * là cổng server đã bị vượt hoặc dữ liệu bị sửa ngoài ứng dụng, người xem cần thấy lỗi.
 * Dựng bằng `DOMParser` + `importNode` chứ không chèn chuỗi HTML.
 */
export function parseSafeSvg(markup: string): { value: SVGSVGElement | null; reason: string | null } {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg') {
    return { value: null, reason: 'parse' };
  }
  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (el.namespaceURI !== SVG_NS || BLOCKED.has(el.localName.toLowerCase())) return { value: null, reason: 'unsafe' };
    for (const attr of Array.from(el.attributes)) {
      if (!attrSafe(el.localName, attr)) return { value: null, reason: 'unsafe' };
    }
  }
  return { value: document.importNode(root, true) as unknown as SVGSVGElement, reason: null };
}

/** Kích thước nội dung: `viewBox` trước (draw.io luôn ghi), lùi về `width`/`height`. */
export function svgSize(svg: Element): Size {
  const box = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  return { width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

/** Thu phóng + dời để cả bản vẽ nằm giữa khung; không phóng quá 100% (chữ nhỏ không vỡ hạt). */
export function fitTransform(content: Size, box: Size): ViewTransform {
  if (content.width <= 0 || content.height <= 0 || box.width <= 0 || box.height <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(box.width / content.width, box.height / content.height, 1);
  return {
    scale,
    x: (box.width - content.width * scale) / 2,
    y: (box.height - content.height * scale) / 2,
  };
}

/** Phần tử `data-cell-id` đúng id (so thuộc tính, không ghép selector từ dữ liệu bản vẽ). */
function cellElement(root: Element, id: string): Element | null {
  for (const el of Array.from(root.querySelectorAll('[data-cell-id]'))) if (el.getAttribute('data-cell-id') === id) return el;
  return null;
}

/**
 * Góc trên-phải của ô trên khung chưa thu phóng: hộp bao SVG trừ gốc `viewBox`. Môi trường không
 * đo được (không `getBBox`) → `null`, nơi gọi lùi về toạ độ đã lưu.
 */
export function cellPoint(svg: SVGSVGElement, el: Element): ViewerPoint | null {
  const box = cellBox(svg, el);
  return box ? { x: box.x + box.width, y: box.y } : null;
}

/** Hộp bao của ô trên khung chưa thu phóng (đã trừ gốc `viewBox`); không đo được → `null`. */
function cellBox(svg: SVGSVGElement, el: Element): ViewerBounds | null {
  const measurable = el as unknown as { getBBox?: () => { x: number; y: number; width: number; height: number } };
  if (typeof measurable.getBBox !== 'function') return null;
  const box = measurable.getBBox();
  const view = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [vx, vy] = view.length === 4 && view.every(Number.isFinite) ? view : [0, 0];
  return { x: box.x - vx, y: box.y - vy, width: box.width, height: box.height };
}

/**
 * Độ lệch giữa toạ độ mô hình draw.io (khung trong chỉ mục ô) và toạ độ trên ảnh SVG: draw.io dời
 * gốc ảnh theo khung bao cả bản vẽ, nên lấy ô mốc ĐẦU TIÊN đo được (`measured[i]` là góc trên-trái
 * của `anchors[i]` trên ảnh, `null` nếu không đo được). Không đo được ô nào thì không dời.
 */
export function ghostOffset(measured: (ViewerPoint | null)[], anchors: { id: string; bounds: ViewerBounds }[]): ViewerPoint {
  for (let i = 0; i < anchors.length; i += 1) {
    const at = measured[i];
    if (at) return { x: at.x - anchors[i].bounds.x, y: at.y - anchors[i].bounds.y };
  }
  return { x: 0, y: 0 };
}

export interface ViewerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * So sánh hai phiên bản trên ảnh xem của bản SAU: ô thêm/đổi tô theo `data-cell-id`, ô bỏ vẽ khung
 * đứt ở `bounds` (toạ độ mô hình của bản trước; `null` = dây, không vẽ nhưng vẫn đếm). `anchors` là
 * ô có khung của bản sau để đo độ lệch ảnh (`ghostOffset`).
 */
export interface ViewerDiff {
  added: string[];
  changed: string[];
  removed: { id: string; label: string; bounds: ViewerBounds | null }[];
  anchors: { id: string; bounds: ViewerBounds }[];
}

function zoomAround(view: ViewTransform, factor: number, at: { x: number; y: number }): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/** Toạ độ trên khung vẽ chưa thu phóng (px của ảnh xem). */
export interface ViewerPoint {
  x: number;
  y: number;
}

/**
 * Một ghim bình luận: bám ô `cellId` nếu ô có trong ảnh xem này; ô đã bỏ (hoặc ghi chú không gắn
 * ô) thì đứng ở `anchor` — vị trí lúc ghim — kèm "(hình đã bỏ)".
 */
export interface ViewerPin {
  id: string;
  cellId: string | null;
  anchor: ViewerPoint | null;
  /** Chữ bình luận (đã cắt ngắn) — hiện ngay trên dấu ghim, không phải bấm mới thấy. */
  label: string;
  resolved: boolean;
  /** Tên ô người đọc được (mã máy / nhãn / "hình không tên") cho tên trợ năng; thiếu thì chỉ đọc chữ. */
  target?: string;
  /** Số bình luận trong luồng (gốc + trả lời), hiện trên dấu. */
  count?: number;
}

/** Một ô bấm được của bản vẽ: id ô (`data-cell-id`), tên đọc cho trợ năng, dấu (nếu có). */
export interface ViewerCell {
  id: string;
  label: string;
  mark?: 'danger' | 'warn' | null;
  /**
   * Ô màu IMS của nét dây (`cable-<n>`, `warn`, `danger`): CSS tô nét theo token của theme ĐANG
   * dùng — không tin màu đã chụp vào SVG lúc lưu (AD-18).
   */
  paint?: string | null;
}

/**
 * Trình xem sơ đồ dùng chung (AD-15, AD-17): SVG ĐÃ LÀM SẠCH chèn vào DOM của IMS — không chạy
 * draw.io — kèm watermark người xem, thu phóng (nút, Ctrl + lăn chuột) và kéo để dời. Tương tác
 * theo ô bám `data-cell-id` của SVG: ô khai trong `cells` thành nút (chuột + bàn phím), mang dấu
 * `mark` (viền đỏ/vàng) — màn quyết định ô nào bấm được và bấm thì làm gì (`onCellClick`).
 */
export function DiagramViewer({
  svg,
  viewer,
  title,
  cells,
  onCellClick,
  selectedCellId,
  pickAnyCell = false,
  pins,
  onPinClick,
  focusCellId,
  highlightCellIds,
  diff,
  layers,
  focusScale,
  cellBounds,
}: {
  svg: string;
  viewer: { fullName: string; email: string };
  title: string;
  cells?: ViewerCell[];
  /** `at` = toạ độ ô trên khung chưa thu phóng (để ghim nhớ vị trí); `null` khi không đo được. */
  onCellClick?: (cellId: string, at?: ViewerPoint | null) => void;
  selectedCellId?: string | null;
  /** Chế độ ghim: MỌI ô của SVG bấm được (hình tự do, dây…), không chỉ ô khai trong `cells`. */
  pickAnyCell?: boolean;
  pins?: ViewerPin[];
  onPinClick?: (pinId: string) => void;
  /** Đổi giá trị = bay tới ô này (giữ mức thu phóng). */
  focusCellId?: string | null;
  /** Tô sáng: các ô này sáng, mọi ô khác mờ đi. `null`/vắng = không tô. */
  highlightCellIds?: string[] | null;
  /** Chế độ so sánh: tô ô thêm/đổi, vẽ khung đứt ô bỏ, hiện chú giải + bộ đếm. */
  diff?: ViewerDiff | null;
  /** Lớp bật/tắt được (nút "Lớp" trên thanh thu phóng). Vắng/rỗng = không có nút. */
  layers?: ViewerLayer[];
  /** Bay tới thì phóng ít nhất tới mức này (tìm thiết bị trên điện thoại: ô phải đọc được). */
  focusScale?: number;
  /**
   * Khung bao ô theo chỉ mục ô (toạ độ mô hình draw.io) — bay tới ô khi không đo được trên SVG,
   * dời theo độ lệch ảnh như khung đứt của so sánh.
   */
  cellBounds?: { id: string; bounds: ViewerBounds }[];
}) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseSafeSvg(svg), [svg]);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; view: ViewTransform; target: EventTarget | null; moved: boolean } | null>(null);
  const clickable = useMemo(() => new Map((cells ?? []).map((cell) => [cell.id, cell])), [cells]);
  const [pinAt, setPinAt] = useState<Map<string, { point: ViewerPoint; removed: boolean }>>(new Map());
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [layersOpen, setLayersOpen] = useState(false);
  /* Ngón đang chạm khung (pointerId → toạ độ trong khung) + mốc lúc bắt đầu phóng hai ngón. */
  const touches = useRef(new Map<number, ViewerPoint>());
  const pinch = useRef<{ view: ViewTransform; a: ViewerPoint; b: ViewerPoint; ids: [number, number] } | null>(null);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !parsed.value) return;
    setView(fitTransform(svgSize(parsed.value), { width: stage.clientWidth, height: stage.clientHeight }));
  }, [parsed]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.replaceChildren(...(parsed.value ? [parsed.value] : []));
    fit();
  }, [parsed, fit]);

  /*
   * Gắn vai trò nút + dấu lên đúng `<g data-cell-id>` của SVG. Chạy lại khi danh sách ô, dấu hay ô
   * đang chọn đổi; SVG mới (đổi phiên bản) cũng dựng lại vì `parsed` đổi kéo theo nhánh trên.
   */
  useLayoutEffect(() => {
    const root = parsed.value;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll('[data-cell-id]'))) {
      const cell = clickable.get(el.getAttribute('data-cell-id') ?? '');
      for (const name of ['data-ims-clickable', 'data-ims-mark', 'data-ims-paint', 'data-ims-selected', 'role', 'tabindex', 'aria-label']) {
        el.removeAttribute(name);
      }
      if (!cell) continue;
      if (cell.paint) el.setAttribute('data-ims-paint', cell.paint);
      el.setAttribute('data-ims-clickable', '');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', cell.label);
      if (cell.mark) el.setAttribute('data-ims-mark', cell.mark);
      if (cell.id === selectedCellId) el.setAttribute('data-ims-selected', '');
    }
  }, [parsed, clickable, selectedCellId]);

  /*
   * Dấu so sánh trên đúng `<g data-cell-id>` + độ lệch để đặt khung đứt của ô bỏ. Gỡ dấu cũ trước:
   * thoát so sánh (hay đổi cặp phiên bản) không được để sót màu của lượt trước.
   */
  const [ghostShift, setGhostShift] = useState<ViewerPoint>({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const root = parsed.value;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll('[data-ims-diff]'))) el.removeAttribute('data-ims-diff');
    if (!diff) return;
    for (const [ids, mark] of [
      [diff.added, 'added'],
      [diff.changed, 'changed'],
    ] as const) {
      for (const id of ids) cellElement(root, id)?.setAttribute('data-ims-diff', mark);
    }
    const shift = ghostOffset(
      diff.anchors.map((anchor) => {
        const el = cellElement(root, anchor.id);
        const box = el ? cellBox(root, el) : null;
        return box ? { x: box.x, y: box.y } : null;
      }),
      diff.anchors,
    );
    setGhostShift((prev) => (prev.x === shift.x && prev.y === shift.y ? prev : shift));
  }, [parsed, diff]);

  /*
   * Vị trí ghim: đo ô trong ảnh xem đang hiện; ô không có ở phiên bản này (đã bỏ) hay không đo
   * được thì dùng toạ độ lưu lúc ghim. Ghim không gắn ô và không toạ độ thì không vẽ (chỉ ở danh sách).
   */
  useLayoutEffect(() => {
    const root = parsed.value;
    const next = new Map<string, { point: ViewerPoint; removed: boolean }>();
    for (const pin of pins ?? []) {
      const el = root && pin.cellId ? cellElement(root, pin.cellId) : null;
      const measured = el && root ? cellPoint(root, el) : null;
      const point = measured ?? pin.anchor;
      if (point) next.set(pin.id, { point, removed: Boolean(pin.cellId) && !el });
    }
    setPinAt(next);
  }, [parsed, pins]);

  /*
   * Tô sáng: mờ những ô KHÔNG sáng và không chứa ô sáng. Lớp/nhóm chứa ô sáng không mờ (độ mờ của
   * cha nhân vào con, mờ cha là mờ luôn ô sáng); ô nằm trong một ô đã mờ cũng không đánh dấu lại
   * (mờ chồng mờ). `querySelectorAll` trả theo thứ tự cây nên cha luôn được xét trước con.
   */
  useLayoutEffect(() => {
    const root = parsed.value;
    if (!root) return;
    const all = Array.from(root.querySelectorAll('[data-cell-id]'));
    for (const el of all) el.removeAttribute('data-ims-dim');
    if (!highlightCellIds || highlightCellIds.length === 0) return;
    const lit = new Set(highlightCellIds);
    const litEls = all.filter((el) => lit.has(el.getAttribute('data-cell-id') ?? ''));
    for (const el of all) {
      if (lit.has(el.getAttribute('data-cell-id') ?? '')) continue;
      if (litEls.some((one) => el.contains(one))) continue;
      const parentCell = el.parentElement?.closest('[data-cell-id]');
      if (parentCell?.hasAttribute('data-ims-dim')) continue;
      el.setAttribute('data-ims-dim', '');
    }
  }, [parsed, highlightCellIds]);

  /* Ẩn ô của lớp đang tắt. Ô không còn trong lớp tắt nào (bật lại, đổi phiên bản) được gỡ dấu. */
  useLayoutEffect(() => {
    const root = parsed.value;
    if (!root) return;
    const hidden = hiddenByLayers(layers ?? [], hiddenLayers);
    for (const el of Array.from(root.querySelectorAll('[data-cell-id]'))) {
      if (hidden.has(el.getAttribute('data-cell-id') ?? '')) el.setAttribute('data-ims-hidden', '');
      else el.removeAttribute('data-ims-hidden');
    }
  }, [parsed, layers, hiddenLayers]);

  /** Ô bấm được gần nhất chứa phần tử (ô con của nhóm thuộc về ô ngoài cùng được khai). */
  const cellAt = (target: EventTarget | null): string | null => {
    let el = target instanceof Element ? target : null;
    while (el && el !== canvasRef.current) {
      const id = el.getAttribute('data-cell-id');
      if (id && (pickAnyCell || clickable.has(id))) return id;
      el = el.parentElement;
    }
    return null;
  };

  const pointOf = (id: string): ViewerPoint | null => {
    const root = parsed.value;
    const el = root ? cellElement(root, id) : null;
    return root && el ? cellPoint(root, el) : null;
  };

  const pinAtTarget = (target: EventTarget | null): string | null => {
    const el = target instanceof Element ? target.closest('[data-pin-id]') : null;
    return el?.getAttribute('data-pin-id') ?? null;
  };

  /*
   * Tâm ô trên khung chưa thu phóng: đo trên SVG; không đo được thì khung bao của chỉ mục ô dời
   * theo độ lệch ảnh (đo trên các ô mốc khác, như khung đứt của so sánh).
   */
  const centerOf = (id: string): ViewerPoint | null => {
    const root = parsed.value;
    if (!root) return null;
    const el = cellElement(root, id);
    const box = el ? cellBox(root, el) : null;
    if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const anchors = cellBounds ?? [];
    const hint = anchors.find((c) => c.id === id);
    if (!hint) return null;
    const shift = ghostOffset(
      anchors.map((anchor) => {
        const at = cellElement(root, anchor.id);
        const measured = at ? cellBox(root, at) : null;
        return measured ? { x: measured.x, y: measured.y } : null;
      }),
      anchors,
    );
    return { x: hint.bounds.x + shift.x + hint.bounds.width / 2, y: hint.bounds.y + shift.y + hint.bounds.height / 2 };
  };

  /* Bay tới ô: đặt tâm ô vào giữa khung, giữ mức thu phóng (phóng tới `focusScale` nếu đang xa hơn). */
  useEffect(() => {
    if (!focusCellId) return;
    const stage = stageRef.current;
    const point = centerOf(focusCellId) ?? (pins ?? []).map((p) => (p.cellId === focusCellId ? pinAt.get(p.id)?.point : undefined)).find(Boolean);
    if (!stage || !point) return;
    setView((v) => {
      const scale = Math.max(v.scale, focusScale ?? 0);
      return { scale, x: stage.clientWidth / 2 - point.x * scale, y: stage.clientHeight / 2 - point.y * scale };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ bay khi đổi ô đích, không bay lại mỗi lần ghim đổi
  }, [focusCellId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => fit());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fit]);

  const center = () => {
    const stage = stageRef.current;
    return { x: (stage?.clientWidth ?? 0) / 2, y: (stage?.clientHeight ?? 0) / 2 };
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    // Chỉ Ctrl/⌘ + lăn mới thu phóng: lăn thường để trang cuộn như mọi nơi khác.
    if (!event.ctrlKey && !event.metaKey) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView((v) => zoomAround(v, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, { x: event.clientX - rect.left, y: event.clientY - rect.top }));
  };

  const stagePoint = (event: PointerEvent<HTMLDivElement>): ViewerPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    touches.current.set(event.pointerId, stagePoint(event));
    // Giữ phần tử bị nhấn: sau `setPointerCapture`, `pointerup` báo chính khung chứ không báo ô.
    drag.current = { x: event.clientX, y: event.clientY, view, target: event.target, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (touches.current.size === 2) {
      // Ngón thứ hai chạm: chuyển từ kéo sang phóng; cú chạm này không còn là bấm ô.
      const [[ia, a], [ib, b]] = [...touches.current.entries()];
      pinch.current = { view, a, b, ids: [ia, ib] };
      drag.current = null;
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, stagePoint(event));
    const two = pinch.current;
    if (two) {
      const a = touches.current.get(two.ids[0]);
      const b = touches.current.get(two.ids[1]);
      if (a && b) setView(pinchView(two.view, two.a, two.b, a, b));
      return;
    }
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) start.moved = true;
    setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
  };
  const liftFinger = (event: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    if (pinch.current && touches.current.size < 2) pinch.current = null;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    liftFinger(event);
    const start = drag.current;
    drag.current = null;
    if (!start || start.moved || !onCellClick) return;
    const id = cellAt(start.target);
    if (id) onCellClick(id, pointOf(id));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    liftFinger(event);
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (pinAtTarget(event.target)) return;
    const id = cellAt(event.target);
    if (!id || !onCellClick) return;
    event.preventDefault();
    onCellClick(id, pointOf(id));
  };

  return (
    <div className="diagram-viewer" role="region" aria-label={title}>
      {parsed.reason ? (
        <p className="diagram-viewer-error" role="alert">
          {t('diagramViewer.unsafe')}
        </p>
      ) : null}
      <div className="diagram-viewer-toolbar" role="toolbar" aria-label={t('diagramViewer.toolbar')}>
        <button type="button" className="btn sm" aria-label={t('diagramViewer.zoomOut')} onClick={() => setView((v) => zoomAround(v, 1 / ZOOM_STEP, center()))}>
          −
        </button>
        <span role="status" aria-label={t('diagramViewer.zoomLevel')} className="diagram-viewer-zoom">
          {Math.round(view.scale * 100)}%
        </span>
        <button type="button" className="btn sm" aria-label={t('diagramViewer.zoomIn')} onClick={() => setView((v) => zoomAround(v, ZOOM_STEP, center()))}>
          +
        </button>
        <button type="button" className="btn sm" onClick={fit}>
          {t('diagramViewer.fit')}
        </button>
        {layers && layers.length > 0 ? (
          <Popover label={t('diagramViewer.layers')} title={t('diagramViewer.layersTitle')} open={layersOpen} onOpenChange={setLayersOpen} buttonClassName="btn sm">
            {LAYER_GROUPS.map((group) => {
              const inGroup = layers.filter((layer) => layer.group === group);
              if (inGroup.length === 0) return null;
              return (
                <fieldset key={group} className="check-list">
                  <legend className="muted">{t(LAYER_GROUP_KEY[group])}</legend>
                  {inGroup.map((layer) => (
                    <label key={layer.key} className="row confirm-check">
                      <input
                        type="checkbox"
                        checked={!hiddenLayers.has(layer.key)}
                        onChange={() =>
                          setHiddenLayers((current) => {
                            const next = new Set(current);
                            if (next.has(layer.key)) next.delete(layer.key);
                            else next.add(layer.key);
                            return next;
                          })
                        }
                      />
                      <span>{layer.label}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </Popover>
        ) : null}
      </div>
      <div
        ref={stageRef}
        className="diagram-viewer-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div
          ref={canvasRef}
          className="diagram-viewer-canvas"
          data-pick-any={pickAnyCell ? '' : undefined}
          data-lod={detailLevel(view.scale)}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
        {pins && pins.length > 0 ? (
          <div className="diagram-viewer-pins" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            {pins.map((pin, index) => {
              const at = pinAt.get(pin.id);
              if (!at) return null;
              const count = pin.count ?? 1;
              const name =
                (pin.target ? t('diagramViewer.pinOn', { n: index + 1, target: pin.target, label: pin.label }) : t('diagramViewer.pin', { n: index + 1, label: pin.label })) +
                (at.removed ? ` ${t('diagramViewer.pinRemoved')}` : '') +
                (count > 1 ? ` · ${t('diagramViewer.pinCount', { count })}` : '');
              // Nhiều ghim cùng một ô xếp chồng lên trên nhau thay vì đè lên nhau.
              const stack = pins.slice(0, index).filter((p) => p.cellId && p.cellId === pin.cellId).length;
              return (
                <button
                  key={pin.id}
                  type="button"
                  className="diagram-pin"
                  data-pin-id={pin.id}
                  data-resolved={pin.resolved ? 'true' : 'false'}
                  data-removed={at.removed ? 'true' : undefined}
                  aria-label={name}
                  title={name}
                  style={{ left: `${at.point.x}px`, top: `${at.point.y}px`, transform: `scale(${1 / view.scale})`, '--pin-stack': stack } as CSSProperties}
                  // Không để khung bắt con trỏ (kéo/`setPointerCapture`): cú bấm phải tới chính nút ghim.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onPinClick?.(pin.id)}
                >
                  <span className="diagram-pin-count" aria-hidden="true">
                    {count}
                  </span>
                  <span className="diagram-pin-text" aria-hidden="true">
                    {pin.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {diff && diff.removed.some((cell) => cell.bounds) ? (
          <div className="diagram-viewer-pins" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            {diff.removed.map((cell) =>
              cell.bounds ? (
                <div
                  key={cell.id}
                  role="img"
                  className="diagram-ghost"
                  aria-label={t('diagramViewer.diffGhost', { label: cell.label })}
                  title={t('diagramViewer.diffGhost', { label: cell.label })}
                  style={{
                    left: `${cell.bounds.x + ghostShift.x}px`,
                    top: `${cell.bounds.y + ghostShift.y}px`,
                    width: `${cell.bounds.width}px`,
                    height: `${cell.bounds.height}px`,
                  }}
                />
              ) : null,
            )}
          </div>
        ) : null}
      </div>
      {diff ? (
        <div className="diagram-viewer-legend" role="group" aria-label={t('diagramViewer.diffLegend')}>
          <span className="diagram-legend-item" data-diff="added">
            {t('diagramViewer.diffAdded', { count: diff.added.length })}
          </span>
          <span className="diagram-legend-item" data-diff="removed">
            {t('diagramViewer.diffRemoved', { count: diff.removed.length })}
          </span>
          <span className="diagram-legend-item" data-diff="changed">
            {t('diagramViewer.diffChanged', { count: diff.changed.length })}
          </span>
        </div>
      ) : null}
      <DiagramWatermark viewer={viewer} />
    </div>
  );
}

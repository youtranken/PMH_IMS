import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DiagramWatermark } from './diagram-watermark';

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
    if (BLOCKED.has(el.localName.toLowerCase())) return { value: null, reason: 'unsafe' };
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.replace(/\s+/g, '');
      if (name.startsWith('on')) return { value: null, reason: 'unsafe' };
      if (/(?:java|vb)script:/i.test(value)) return { value: null, reason: 'unsafe' };
      if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#') && !(el.localName === 'image' && SAFE_IMAGE.test(value))) {
        return { value: null, reason: 'unsafe' };
      }
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

function zoomAround(view: ViewTransform, factor: number, at: { x: number; y: number }): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/** Một ô bấm được của bản vẽ: id ô (`data-cell-id`), tên đọc cho trợ năng, dấu (nếu có). */
export interface ViewerCell {
  id: string;
  label: string;
  mark?: 'danger' | 'warn' | null;
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
}: {
  svg: string;
  viewer: { fullName: string; email: string };
  title: string;
  cells?: ViewerCell[];
  onCellClick?: (cellId: string) => void;
  selectedCellId?: string | null;
}) {
  const { t } = useTranslation();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseSafeSvg(svg), [svg]);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; view: ViewTransform; target: EventTarget | null; moved: boolean } | null>(null);
  const clickable = useMemo(() => new Map((cells ?? []).map((cell) => [cell.id, cell])), [cells]);

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
      for (const name of ['data-ims-clickable', 'data-ims-mark', 'data-ims-selected', 'role', 'tabindex', 'aria-label']) el.removeAttribute(name);
      if (!cell) continue;
      el.setAttribute('data-ims-clickable', '');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', cell.label);
      if (cell.mark) el.setAttribute('data-ims-mark', cell.mark);
      if (cell.id === selectedCellId) el.setAttribute('data-ims-selected', '');
    }
  }, [parsed, clickable, selectedCellId]);

  /** Ô bấm được gần nhất chứa phần tử (ô con của nhóm thuộc về ô ngoài cùng được khai). */
  const cellAt = (target: EventTarget | null): string | null => {
    let el = target instanceof Element ? target : null;
    while (el && el !== canvasRef.current) {
      const id = el.getAttribute('data-cell-id');
      if (id && clickable.has(id)) return id;
      el = el.parentElement;
    }
    return null;
  };

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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Giữ phần tử bị nhấn: sau `setPointerCapture`, `pointerup` báo chính khung chứ không báo ô.
    drag.current = { x: event.clientX, y: event.clientY, view, target: event.target, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) start.moved = true;
    setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
  };
  const onPointerUp = () => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.moved || !onCellClick) return;
    const id = cellAt(start.target);
    if (id) onCellClick(id);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const id = cellAt(event.target);
    if (!id || !onCellClick) return;
    event.preventDefault();
    onCellClick(id);
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
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <DiagramWatermark viewer={viewer} />
    </div>
  );
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiagramWatermark } from './diagram-watermark';
import {
  DRAWIO_SANDBOX,
  buildDrawioConfig,
  cssColorToDrawio,
  drawioUrl,
  parseDrawioEvent,
  serializeDrawioCommand,
  type DrawioCommand,
  type DrawioEvent,
  type DrawioMode,
} from './drawio-protocol';

/**
 * Ô màu dây IMS (`imsPaint`) → token màu dây của GIẤY trong `tokens.css`. Giấy trình vẽ luôn sáng
 * ở cả hai theme, nên nét dây dùng bộ màu của giấy chứ không bộ màu của theme (V-05) — trình xem và
 * chú giải đọc cùng bộ đó.
 */
const CABLE_PAINTS: Record<string, string> = {
  'cable-0': '--paper-cable-0',
  'cable-1': '--paper-cable-1',
  'cable-2': '--paper-cable-2',
  'cable-3': '--paper-cable-3',
  'cable-4': '--paper-cable-4',
  'cable-5': '--paper-cable-5',
  'cable-6': '--paper-cable-6',
  'cable-7': '--paper-cable-7',
  'cable-8': '--paper-cable-8',
  warn: '--paper-cable-warn',
  danger: '--paper-cable-danger',
};

/**
 * Bảng ô màu dây → mã màu draw.io, đọc từ token lúc nạp trình vẽ. Mã nguồn không chứa mã màu nào;
 * đổi màu là sửa `tokens.css`.
 */
export function readCablePalette(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const [paint, token] of Object.entries(CABLE_PAINTS)) {
    const color = cssColorToDrawio(style.getPropertyValue(token));
    if (color) out[paint] = color;
  }
  return out;
}

export interface DrawioFrameHandle {
  send: (command: DrawioCommand) => void;
}

export interface DrawioFrameProps {
  mode: DrawioMode;
  /** Tên trợ năng của iframe. */
  title: string;
  /** XML nạp khi trình vẽ báo `init` — đã qua cổng kiểm của server. */
  initialXml: string;
  /** Người đang xem: watermark bắt buộc, không có prop nào tắt được (AD-17). */
  viewer: { fullName: string; email: string };
  /** `diagram.editor_init_timeout_seconds` */
  initTimeoutSeconds: number;
  onEvent?: (event: DrawioEvent) => void;
}

/** Bảng màu gợi ý của draw.io = các ô màu loại dây 1..8. */
function readWireColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6, 7, 8].map((n) => style.getPropertyValue(`--diagram-cable-${n}`));
}

/**
 * Cầu nối DUY NHẤT tạo iframe draw.io (AD-15, AD-17). Màn dùng nó nhận sự kiện có kiểu qua
 * `onEvent` và gửi lệnh có kiểu qua `ref.send` — không màn nào tự `postMessage` với trình vẽ.
 *
 * Kiểm nguồn bằng `event.source === iframe.contentWindow`, không bằng origin: khung sandbox không
 * có `allow-same-origin` nên origin của nó là "null", và tin "null" là tin mọi khung sandbox khác
 * trên trang.
 */
export const DrawioFrame = forwardRef<DrawioFrameHandle, DrawioFrameProps>(function DrawioFrame(
  { mode, title, initialXml, viewer, initTimeoutSeconds, onEvent },
  ref,
) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [initialised, setInitialised] = useState(false);
  const [stalled, setStalled] = useState(false);
  const latest = useRef({ onEvent, initialXml, mode });
  useLayoutEffect(() => {
    latest.current = { onEvent, initialXml, mode };
  });

  /*
   * Đích '*' là bắt buộc với khung nguồn gốc mờ (không có origin nào để ghi). Tin vẫn chỉ tới
   * đúng cửa sổ con của khung này, và CSP `frame-src 'self'` của SPA không cho khung điều hướng
   * sang trang ngoài để nhận thay.
   */
  const send = useCallback((command: DrawioCommand) => {
    frameRef.current?.contentWindow?.postMessage(serializeDrawioCommand(command), '*');
  }, []);
  useImperativeHandle(ref, () => ({ send }), [send]);

  useEffect(() => {
    const listen = (message: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || message.source !== frame.contentWindow) return;
      const event = parseDrawioEvent(message.data);
      if (!event) return;
      if (event.event === 'configure') {
        send({ action: 'configure', config: buildDrawioConfig(readWireColors()) });
      } else if (event.event === 'init') {
        setInitialised(true);
        setStalled(false);
        const { initialXml: xml, mode: current } = latest.current;
        send({ action: 'load', xml, autosave: current === 'edit' });
      }
      latest.current.onEvent?.(event);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [send]);

  useEffect(() => {
    if (initialised) return undefined;
    const timer = window.setTimeout(() => setStalled(true), initTimeoutSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [initialised, initTimeoutSeconds, attempt]);

  return (
    <div className="drawio-frame">
      <iframe
        key={attempt}
        ref={frameRef}
        className="drawio-frame-iframe"
        title={title}
        src={drawioUrl(mode)}
        sandbox={DRAWIO_SANDBOX}
      />
      <DiagramWatermark viewer={viewer} />
      {stalled ? (
        <div className="drawio-frame-stalled" role="alert">
          <p>
            <strong>{t('drawioFrame.notReady')}</strong>
          </p>
          <p className="muted">{t('drawioFrame.notReadyHint')}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStalled(false);
              setInitialised(false);
              setAttempt((n) => n + 1);
            }}
          >
            {t('drawioFrame.retry')}
          </button>
        </div>
      ) : null}
    </div>
  );
});

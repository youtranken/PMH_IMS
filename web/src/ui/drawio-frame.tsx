import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DRAWIO_SANDBOX,
  buildDrawioConfig,
  drawioUrl,
  parseDrawioEvent,
  serializeDrawioCommand,
  watermarkText,
  type DrawioCommand,
  type DrawioEvent,
  type DrawioMode,
} from './drawio-protocol';

/** Token màu dây trong `tokens.css` (có cặp dark) — đọc lúc chạy, đẩy cho draw.io làm bảng màu. */
const WIRE_TOKENS = ['--diagram-wire-1', '--diagram-wire-2', '--diagram-wire-3', '--diagram-wire-4', '--diagram-wire-5', '--diagram-wire-6'];

/** Số dòng watermark lặp trên khung: đủ phủ một màn lớn mà không phải đo kích thước. */
const WATERMARK_ROWS = 8;

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

function readWireColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return WIRE_TOKENS.map((token) => style.getPropertyValue(token));
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

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const mark = watermarkText(viewer, now);

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
      <div className="drawio-watermark" aria-hidden="true">
        {Array.from({ length: WATERMARK_ROWS }, (_, i) => (
          <span key={i}>{mark}</span>
        ))}
      </div>
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

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { parseDrawioMessage, type DrawioMessage } from './drawio-bridge';

/**
 * Nối một `<iframe>` draw.io với màn: nhận tin `event`, gửi tin `action`.
 *
 * Khung chạy `sandbox` không có `allow-same-origin`, nên origin của nó là chuỗi "null" — kiểm
 * bằng origin thì hoặc chặn hết, hoặc phải tin "null" (tức tin MỌI khung sandbox khác trên trang).
 * Kiểm bằng `event.source` mới đúng: chỉ tin từ đúng cửa sổ con của khung này mới được đọc.
 */
export function useDrawioFrame(onMessage: (message: DrawioMessage) => void) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  useLayoutEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const message = parseDrawioMessage(event.data);
      if (message) handler.current(message);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  /*
   * Đích '*' là bắt buộc với khung nguồn gốc mờ (không có origin nào để ghi). Tin vẫn chỉ tới
   * đúng cửa sổ con của khung này, và CSP `frame-src 'self'` của SPA không cho khung điều hướng
   * sang trang ngoài để nhận thay.
   */
  const post = useCallback((action: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(action), '*');
  }, []);

  return { frameRef, post };
}

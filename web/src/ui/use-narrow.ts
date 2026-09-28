import { useEffect, useState } from 'react';

/**
 * Ngưỡng "màn hẹp" — PHẢI khớp `@media (max-width: 900px)` trong css/shell.css. Lệch một
 * pixel là có vùng viewport mà JS nghĩ rộng còn CSS nghĩ hẹp (hoặc ngược lại).
 */
export const NARROW_QUERY = '(max-width: 900px)';

/** Đang ở màn hẹp (điện thoại, máy tính bảng dọc) — cập nhật khi xoay máy / đổi cỡ cửa sổ. */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

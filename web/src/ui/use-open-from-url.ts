import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * `?new=1` trên URL thì gọi `open` một lần rồi bỏ tham số (thay URL, không thêm lượt lùi) — để F5
 * không mở lại form. Lệnh "Thêm …" của Tìm nhanh (UX-E32) dẫn tới đây. `open` phải gọi lại được
 * vô hại (thường là `setX(true)`): effect có thể chạy lại trước khi URL kịp bỏ tham số.
 */
export function useOpenFromUrl(open: () => void, flag = 'new'): void {
  const [params, setParams] = useSearchParams();
  const wanted = params.get(flag) === '1';
  useEffect(() => {
    if (!wanted) return;
    open();
    const next = new URLSearchParams(params);
    next.delete(flag);
    setParams(next, { replace: true });
  }, [wanted, open, params, setParams, flag]);
}

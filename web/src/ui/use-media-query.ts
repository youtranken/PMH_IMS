import { useEffect, useState } from 'react';

/**
 * `true` khi media query đang khớp, cập nhật khi cửa sổ đổi cỡ.
 *
 * Dùng khi JS phải vẽ KHÁC đi theo bề ngang (thẻ thay bảng), không chỉ đổi kiểu dáng: ẩn bằng
 * CSS thì cả hai bản cùng nằm trong DOM — trình đọc màn hình và `getByRole` thấy mọi nút hai
 * lần. Chuỗi query PHẢI khớp mốc `@media` tương ứng trong CSS, lệch một pixel là có dải bề
 * ngang mà JS và CSS hiểu khác nhau.
 *
 * Môi trường không có `matchMedia` (jsdom) coi như không khớp — tức giữ bố cục desktop.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}

function read(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

import { useEffect, useState } from 'react';

/** Quãng yên của ô tìm gọi API: đủ ngắn để thấy "gõ tới đâu ra tới đó", đủ dài để không bắn mỗi phím. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Giá trị "đã lắng": chỉ đổi khi `value` đứng yên `delayMs`. Dùng cho ô tìm gọi API — gõ "PC-01"
 * là một request, không phải năm.
 *
 * Giá trị ĐẦU trả ngay (không chờ): ô mở ra với chữ sẵn (sửa hồ sơ) thì danh sách khớp phải có
 * luôn, không trắng 250ms.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

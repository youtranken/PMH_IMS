import { useEffect, useState } from 'react';
import { errorCode, errorMessage } from '@/lib/api';

/**
 * Lỗi MÁY CHỦ thuộc về MỘT Ô (trùng mã, trùng email…) hiện ngay dưới ô đó và đưa tiêu điểm vào ô
 * (FM-10) — lỗi hay gặp nhất khi nhập liệu mà nằm ở đầu form thì trên điện thoại phải cuộn lên
 * tìm, rồi cuộn xuống tìm ô sai.
 *
 * `claim(err, { MÃ_LỖI: id-ô })`: mã lỗi có trong bảng → giữ câu của API cho ô đó, trả `true`;
 * không có → trả `false`, nơi gọi báo ở đầu form như cũ. Đổi một giá trị trong `watch` thì lỗi
 * tắt (câu nói về giá trị LÚC GỬI), như `useSubmitError`.
 */
export function useServerFieldErrors(watch: readonly unknown[]) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState(watch);
  const [focusId, setFocusId] = useState<string | null>(null);
  if (seen.length !== watch.length || seen.some((value, index) => !Object.is(value, watch[index]))) {
    setSeen(watch);
    if (Object.keys(errors).length > 0) setErrors({});
  }
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);
  return {
    claim: (err: unknown, fields: Record<string, string>): boolean => {
      const code = errorCode(err);
      const id = code ? fields[code] : undefined;
      if (!id) return false;
      setErrors({ [id]: errorMessage(err) });
      setFocusId(id);
      return true;
    },
    error: (id: string): string | null => errors[id] ?? null,
  };
}

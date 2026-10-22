import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Form Thêm điền sẵn mã kế tiếp (FM-21) — `GET …/next-code` của màn (Thiết bị, Phần mềm theo loại,
 * Đường truyền). Chỉ điền khi ô Mã còn TRỐNG và chỉ một lần, rồi bôi chọn để gõ đè được ngay;
 * không đè thứ người dùng đã gõ. `url = null` (form Sửa) thì không hỏi. Hỏng thì im — ô vẫn trống
 * như trước, gợi ý chỉ là tiện ích.
 */
export function useSuggestedCode(url: string | null, current: string, apply: (code: string) => void, inputId: string): void {
  const done = useRef(false);
  const suggestion = useQuery({
    queryKey: ['next-code', url],
    queryFn: () => apiFetch<{ code: string | null }>(url ?? ''),
    enabled: url !== null,
    retry: false,
    staleTime: 0,
  });
  const code = suggestion.data?.code ?? null;
  useEffect(() => {
    if (done.current || !code || current.trim() !== '') return;
    done.current = true;
    apply(code);
    window.requestAnimationFrame(() => {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement && document.activeElement === input) input.select();
    });
  }, [code, current, apply, inputId]);
}

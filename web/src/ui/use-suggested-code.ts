import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Form Thêm điền sẵn mã kế tiếp (FM-21) — `GET …/next-code` của màn (Thiết bị, Phần mềm theo loại,
 * Đường truyền). Chỉ điền khi ô Mã còn TRỐNG, rồi bôi chọn để gõ đè được ngay; không đè thứ người
 * dùng đã gõ. `url = null` (form Sửa) thì không hỏi. Hỏng thì im — gợi ý chỉ là tiện ích.
 *
 * Chỉ dùng câu trả lời của lượt hỏi SAU khi form mở (`gcTime: 0`, `isFetchedAfterMount`): bản
 * cache của lượt mở trước có thể là đúng mã vừa lưu → bấm Lưu là trùng mã. Ô Mã bị xoá trắng
 * sau khi đã điền ("Lưu & thêm tiếp") thì hỏi lại để có mã kế tiếp của mã vừa lưu.
 */
export function useSuggestedCode(url: string | null, current: string, apply: (code: string) => void, inputId: string): void {
  /** `dataUpdatedAt` của câu trả lời đã điền — chỉ điền câu trả lời MỚI hơn nó. */
  const appliedAt = useRef(0);
  const asked = useRef(0);
  const suggestion = useQuery({
    queryKey: ['next-code', url],
    queryFn: () => apiFetch<{ code: string | null }>(url ?? ''),
    enabled: url !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const { refetch, dataUpdatedAt, isFetching, isFetchedAfterMount } = suggestion;
  const code = suggestion.data?.code ?? null;
  const empty = current.trim() === '';

  // Đã điền rồi mà ô bị xoá trắng ("Lưu & thêm tiếp") → hỏi lại một lần cho mã kế tiếp.
  useEffect(() => {
    if (url === null || !empty || appliedAt.current === 0 || isFetching) return;
    if (dataUpdatedAt > appliedAt.current || asked.current === appliedAt.current) return;
    asked.current = appliedAt.current;
    void refetch();
  }, [url, empty, isFetching, dataUpdatedAt, refetch]);

  useEffect(() => {
    if (!isFetchedAfterMount || isFetching || !code || !empty || dataUpdatedAt <= appliedAt.current) return;
    appliedAt.current = dataUpdatedAt;
    apply(code);
    window.requestAnimationFrame(() => {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement && document.activeElement === input) input.select();
    });
  }, [isFetchedAfterMount, isFetching, code, empty, dataUpdatedAt, apply, inputId]);
}

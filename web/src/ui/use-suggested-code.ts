import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Form Thêm điền sẵn mã kế tiếp (FM-21) — `GET …/next-code` của màn (Thiết bị, Phần mềm theo loại,
 * Đường truyền). Chỉ điền khi ô Mã còn TRỐNG, rồi bôi chọn để gõ đè được ngay; không đè thứ người
 * dùng đã gõ. `url = null` (form Sửa) thì không hỏi. Hỏng thì im — gợi ý chỉ là tiện ích.
 *
 * Chỉ dùng câu trả lời của lượt hỏi SAU khi form mở (`gcTime: 0`, `isFetchedAfterMount`): bản
 * cache của lượt mở trước có thể là đúng mã vừa lưu → bấm Lưu là trùng mã. Mỗi câu trả lời chỉ
 * được dùng MỘT lần: người dùng tự xoá ô để gõ mã riêng thì không bị điền chen lại. `round` đổi
 * (form đặt lại sau "Lưu & thêm tiếp") thì hỏi lại để có mã kế tiếp của mã vừa lưu.
 *
 * Trả về giá trị cho `data-guard-value` của ô Mã: mã còn đúng là mã gợi ý thì `''` — mã do hệ
 * thống điền không phải "người dùng đã gõ", Esc đóng hộp ngay không hỏi bỏ thay đổi (`ui/dialog`).
 */
export function useSuggestedCode(
  url: string | null,
  current: string,
  apply: (code: string) => void,
  inputId: string,
  round = 0,
): string | undefined {
  /** `dataUpdatedAt` của câu trả lời đã điền — chỉ điền câu trả lời MỚI hơn nó. */
  const appliedAt = useRef(0);
  const appliedCode = useRef<string | null>(null);
  const askedRound = useRef(round);
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

  useEffect(() => {
    if (url === null || askedRound.current === round) return;
    askedRound.current = round;
    void refetch();
  }, [url, round, refetch]);

  useEffect(() => {
    if (!isFetchedAfterMount || isFetching || dataUpdatedAt <= appliedAt.current) return;
    // Câu trả lời này đã "dùng" dù có điền hay không: tới lúc ô trống lại (người dùng tự xoá) thì
    // không lôi nó ra điền chen vào chữ họ sắp gõ.
    appliedAt.current = dataUpdatedAt;
    if (!code || !empty) return;
    appliedCode.current = code;
    apply(code);
    window.requestAnimationFrame(() => {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement && document.activeElement === input) input.select();
    });
  }, [isFetchedAfterMount, isFetching, code, empty, dataUpdatedAt, apply, inputId]);
  return appliedCode.current !== null && current === appliedCode.current ? '' : undefined;
}

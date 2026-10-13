import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/** Việc phiếu đổi theo ngày, không theo giây — năm phút một lần là đủ cho số trên menu. */
const REFRESH_MS = 5 * 60_000;

/** Khoá nằm dưới nhánh `['iso']`: mọi lượt ghi phiếu làm mới nhánh đó nên số trên menu đi theo. */
export const ISO_TODO_KEY = ['iso', 'todo'] as const;

/**
 * Số việc phiếu ISO đang chờ người này (Q-28): kỳ chờ duyệt (SA/Admin), ô ✗ chưa có 0206 và kỳ
 * chờ bản ký của phiếu họ phụ trách. Hiện trên đầu nhóm "Phiếu ISO" khi nhóm thu gọn.
 */
export function useIsoTodoCount(): number {
  const todo = useQuery({
    queryKey: ISO_TODO_KEY,
    queryFn: () => apiFetch<{ count: number }>('/api/v1/iso/todo'),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  return todo.data?.count ?? 0;
}

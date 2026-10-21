import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/** Việc phiếu đổi theo ngày, không theo giây — năm phút một lần là đủ cho số trên menu. */
const REFRESH_MS = 5 * 60_000;

/** Khoá nằm dưới nhánh `['iso']`: mọi lượt ghi phiếu làm mới nhánh đó nên số trên menu đi theo. */
export const ISO_TODO_KEY = ['iso', 'todo'] as const;

export interface IsoTodo {
  /** Tổng — số trên đầu nhóm "Phiếu ISO" khi nhóm thu gọn. */
  count: number;
  /** Ô ✗ chưa có 0206 của phiếu người này ghi được → mục "Sự cố · 0206". */
  unlinked: number;
  /** Kỳ chờ duyệt (SA/Admin) + kỳ đã chốt chờ bản ký → mục "Kỳ phiếu & chốt kỳ". */
  periods: number;
}

/**
 * Việc phiếu ISO đang chờ người này (Q-28), tách theo mục phải mở để làm việc đó.
 */
export function useIsoTodo(enabled = true): IsoTodo {
  const todo = useQuery({
    queryKey: ISO_TODO_KEY,
    queryFn: () => apiFetch<{ count: number; pendingApprovals: number; unlinkedFails: number; awaitingSigned: number }>('/api/v1/iso/todo'),
    // Nhóm quyền không có phiếu nào (Q-31) thì API trả 403 — không hỏi.
    enabled,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  const data = todo.data;
  return {
    count: data?.count ?? 0,
    unlinked: data?.unlinkedFails ?? 0,
    periods: (data?.pendingApprovals ?? 0) + (data?.awaitingSigned ?? 0),
  };
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Mục đã quá hạn chỉ đổi theo ngày hoặc khi ai đó gia hạn — năm phút một lần là thừa đủ, và
 * route này không gia hạn idle của phiên (`@NoIdleTouch`) nên hỏi định kỳ không giữ phiên sống.
 */
const REFRESH_MS = 5 * 60_000;

/**
 * Số mục ĐÃ quá hạn — badge của mục "Sắp hết hạn" trên menu. Mọi vai đều thấy mục đó.
 *
 * Khoá nằm dưới `['expiry']` để lượt gia hạn trên màn Sắp hết hạn (vốn làm mới cả nhánh đó) kéo
 * badge về đúng số ngay, không phải chờ vòng hỏi kế tiếp.
 */
/** `enabled = false` khi nhóm quyền ẩn Sắp hết hạn (Q-31): không hỏi một API sẽ trả 403. */
export function useOverdueExpiryCount(enabled = true): number {
  const count = useQuery({
    queryKey: ['expiry', 'overdue-count'],
    queryFn: () => apiFetch<{ count: number }>('/api/v1/expiry/overdue/count'),
    enabled,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  return count.data?.count ?? 0;
}

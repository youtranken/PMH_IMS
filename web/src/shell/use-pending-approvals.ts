import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { BREAK_GLASS_KEY } from '@/ui/break-glass';

/**
 * Hỏi lại mỗi phút: đủ để người duyệt đang mở app thấy yêu cầu mới trong lúc làm việc khác,
 * mà không biến shell thành một vòng hỏi dồn dập ở MỌI màn. Quay lại tab thì react-query tự hỏi
 * ngay, nên người mở app từ thư không phải chờ tròn phút.
 */
const REFRESH_MS = 60_000;

/**
 * Số yêu cầu break-glass NGƯỜI NÀY duyệt được (không tính phiếu của chính họ) — badge menu và
 * chấm trên nút mở menu ở điện thoại. Member không duyệt nên không hỏi: 0.
 *
 * Khoá nằm dưới `['break-glass', 'pending']` để mọi lượt quyết (vốn làm mới cả nhánh đó) kéo
 * luôn badge về đúng số, không phải chờ vòng hỏi kế tiếp.
 */
export function usePendingApprovalCount(me: Me): number {
  const canDecide = me.role === 'sa' || me.role === 'admin';
  const count = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'pending', 'count'],
    queryFn: () => apiFetch<{ count: number }>('/api/v1/vault/break-glass/pending/count'),
    enabled: canDecide,
    refetchInterval: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  return canDecide ? (count.data?.count ?? 0) : 0;
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';

/** Thư lỗi đổi theo nhịp relay (phút), không theo từng giây — năm phút một lần là đủ cho badge. */
const REFRESH_MS = 5 * 60_000;

/**
 * Số thư gửi lỗi chưa xử (Q-25) — badge của mục "Thư gửi lỗi". CHỈ SA hỏi: API chỉ mở cho SA,
 * vai khác hỏi là một lượt 403 mỗi năm phút. Khoá nằm dưới nhánh của màn (`['outbox-failed']`)
 * để "Gửi lại" làm mới cả badge.
 */
export function useFailedMailCount(me: Me): number {
  const count = useQuery({
    queryKey: ['outbox-failed', 'count'],
    queryFn: () => apiFetch<{ count: number }>('/api/v1/admin/outbox/failed/count'),
    enabled: me.role === 'sa',
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  return me.role === 'sa' ? (count.data?.count ?? 0) : 0;
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';

/** Một bản vẽ đang chờ người này duyệt — chỉ tên / người gửi, không nội dung (D-07). */
export interface PendingDiagramReview {
  approvalId: string;
  diagramId: string;
  name: string;
  requester: string;
  requesterName: string;
  seq: number | null;
  submittedAt: string;
}

/**
 * Khoá dưới nhánh `['diagram-reviews']`: mọi lượt gửi / duyệt / trả về / rút làm mới nhánh đó, nên
 * badge và khối trên màn Duyệt về đúng số mà không chờ vòng hỏi kế tiếp.
 */
export const DIAGRAM_REVIEWS_KEY = ['diagram-reviews', 'pending'] as const;

/** Cùng nhịp với badge duyệt mở két: đủ để người duyệt đang mở app thấy việc mới trong vài phút. */
const REFRESH_MS = 60_000;

/**
 * Hàng chờ duyệt bản vẽ của Admin/SA đang đăng nhập (D-07) — badge mục "Sơ đồ mạng" và khối
 * "Bản vẽ chờ duyệt" của màn Duyệt dùng chung một truy vấn. Thành viên không duyệt nên không hỏi.
 */
export function usePendingDiagramReviews(me: Me): { rows: PendingDiagramReview[]; isError: boolean } {
  const canDecide = me.role === 'sa' || me.role === 'admin';
  const query = useQuery({
    queryKey: DIAGRAM_REVIEWS_KEY,
    queryFn: () => apiFetch<PendingDiagramReview[]>('/api/v1/diagrams/reviews/pending'),
    enabled: canDecide,
    refetchInterval: REFRESH_MS,
    // Badge là đồ trang trí cho điều hướng — hỏng thì im, không kéo lỗi lên cả shell.
    retry: false,
  });
  return { rows: canDecide && Array.isArray(query.data) ? query.data : [], isError: query.isError };
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Danh mục LOẠI HẠN và nhãn tiếng Việt của chúng — MỘT nơi hỏi (AD-15).
 *
 * ===== VÌ SAO NHÃN ĐẾN TỪ API, KHÔNG PHẢI TỪ `vi.ts` =====
 *
 * Loại hạn do API quyết (`GET /expiry/kinds` trả sẵn `label`), vì chính nó biết mỗi loại lấy
 * ngày từ bảng nào. Khai thêm một bộ nhãn `expiry.kind_*` trong `vi.ts` là dựng BẢN LUẬT THỨ
 * HAI cho cùng một khái niệm — thêm loại hạn ở API thì một trong hai bản sẽ lệch, và bản lệch
 * là bản người dùng nhìn thấy.
 *
 * ===== LỖI ĐANG VÁ (rà UI/UX 12/09) =====
 *
 * Bảng điều khiển gọi `t('expiry.kind_' + kind, kind)` trong khi `vi.ts` KHÔNG có khóa
 * `expiry.kind_*` nào. i18next lặng lẽ rơi về tham số mặc định — tức chính cái mã — nên khối
 * "Sắp hết hạn" của màn mở đầu mỗi ngày in ra `warranty · 21/09/2026`, `license · 27/08/2026`.
 * Màn `/expiry` cùng lúc lại hiện đúng "Bảo hành thiết bị", vì nó hỏi API.
 *
 * Hỏng theo kiểu khó thấy: `license` trông đủ giống một nhãn để mắt lướt qua. Lượt test tay
 * 12/09 đi qua đúng khối này và đọc nhầm thành rác dữ liệu.
 *
 * ===== CÙNG MỘT `queryKey` LÀ CỐ Ý =====
 *
 * Ba nơi dùng chung khóa `['expiry','kinds']` nên react-query gộp thành MỘT lượt gọi và chia
 * cache — thêm khối này vào bảng điều khiển không tốn thêm một vòng mạng nào.
 */
export interface ExpiryKind {
  kind: string;
  label: string;
  /** Loại có gia hạn được bằng nút "Gia hạn" không — bảo hành thiết bị thì không. */
  canRenew: boolean;
}

export function useExpiryKinds() {
  return useQuery({
    queryKey: ['expiry', 'kinds'],
    queryFn: () => apiFetch<ExpiryKind[]>('/api/v1/expiry/kinds'),
  });
}

/**
 * Nhãn của một loại hạn, hoặc chính mã đó khi chưa tải xong / gọi hỏng.
 *
 * Vẫn rơi về mã thay vì để trống: một dòng "· 27/08/2026" cụt đầu khiến người đọc tưởng dữ
 * liệu thiếu, còn thấy `license` thì ít nhất biết là nhãn chưa về. Khác chỗ hỏng cũ ở chỗ nay
 * nó chỉ xảy ra khi MẠNG hỏng, không phải mọi lúc.
 */
export function expiryKindLabel(kinds: ExpiryKind[] | undefined, kind: string): string {
  return kinds?.find((item) => item.kind === kind)?.label ?? kind;
}

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { DEFAULT_EXPIRY_THRESHOLDS, type ExpiryThresholds } from '@/lib/expiry';

const EXPIRY_THRESHOLDS_KEY = ['expiry', 'thresholds'] as const;

/**
 * Hai ngưỡng "sắp hết hạn" ĐANG HIỆU LỰC, đọc từ server (AD-11, migration 0041).
 *
 * ===== VÌ SAO CẦN =====
 *
 * Luật "sắp hết hạn" của hệ thống là hai con số (7 gấp / 30 sắp). Viết cứng ở nhiều chỗ độc
 * lập (API lẫn web) thì chúng chỉ "khớp nhau" bằng lời hứa, không bằng cơ chế: đổi một chỗ mà
 * quên chỗ kia thì chip đếm và huy hiệu trên hàng nói hai luật khác nhau, và không bài kiểm
 * nào bắt được vì mỗi bên tự nhất quán với chính nó. Nên server là nguồn duy nhất.
 *
 * ===== VÌ SAO VẪN CÓ MẶC ĐỊNH =====
 *
 * `DEFAULT_EXPIRY_THRESHOLDS` KHÔNG còn là bản sao của luật, nó là thứ dùng trong lúc câu hỏi
 * chưa về (và khi mạng hỏng). Vẽ huy hiệu XÁM cho mọi thứ trong 200ms đầu rồi đổi màu là một
 * cú nháy tệ hơn nhiều so với vẽ đúng ngay bằng giá trị mặc định — vốn trùng giá trị seed.
 *
 * `staleTime` dài: đây là tham số vận hành, không phải dữ liệu nghiệp vụ. Nó đổi vài lần một
 * năm, còn `ExpiryBadge` thì render hàng trăm lần một màn.
 */
export function useExpiryThresholds(): ExpiryThresholds {
  const query = useQuery({
    queryKey: EXPIRY_THRESHOLDS_KEY,
    queryFn: () => apiFetch<ExpiryThresholds>('/api/v1/expiry/thresholds'),
    staleTime: 10 * 60_000,
    /*
     * KHÔNG thử lại và KHÔNG kêu lên. Đây là thứ trang trí cho một màn đang hiển thị dữ liệu
     * thật: hỏng thì lùi về mặc định và im lặng, chứ không được nuốt màn hình bằng một thông
     * báo lỗi về hai con số ngưỡng. (Khác hẳn `useCatalogLists` — ở đó danh sách rỗng
     * làm người dùng chọn nhầm, nên bắt buộc phải kêu.)
     */
    retry: false,
  });
  return query.data ?? DEFAULT_EXPIRY_THRESHOLDS;
}

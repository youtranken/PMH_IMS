import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { CatalogLists } from '@/lib/catalog-types';

/**
 * Danh mục nền (loại thiết bị · vị trí · tủ · bộ phận · nhà cung cấp · nhà mạng · cổng dịch vụ)
 * — MỘT nơi hỏi, cho cả hệ thống (AD-15).
 *
 * Trước 08/09 câu hỏi này được chép nguyên văn ở 11 chỗ: `devices-screen`, `device-detail`,
 * `devices/device-form` qua nơi gọi, `catalog-screen`, `nat-screen` (2 lần), `subnet-form`,
 * `isp-screen`, `isp-detail`, `software-screen`, `software-detail`, `use-departments`. Cả 11
 * bản trùng khớp nhau — hôm nay. Rủi ro không phải là gõ lại 3 dòng, mà là bản thứ 12 (hoặc
 * một lần sửa chỉ chạm 11 trong 12 bản) quên `includeInactive=true`: hai màn khi đó trả lời
 * KHÁC NHAU về cùng một danh mục, và không có gì đỏ lên.
 *
 * `includeInactive=true` là cố ý ở MỌI nơi gọi: hồ sơ cũ vẫn trỏ tới mục đã vô hiệu, và một ô
 * chọn không có mục đó sẽ hiện ô trống thay vì tên phòng ban đã giải thể. Việc lọc `active`
 * là chuyện của nơi gọi (xem `useDepartments`), không phải của tầng lấy dữ liệu.
 */
export const CATALOG_LISTS_KEY = ['catalog', 'lists'] as const;

export function useCatalogLists(options?: { enabled?: boolean }): UseQueryResult<CatalogLists> {
  return useQuery({
    queryKey: CATALOG_LISTS_KEY,
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
    enabled: options?.enabled ?? true,
  });
}

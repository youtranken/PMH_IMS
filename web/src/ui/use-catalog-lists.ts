import { createElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { CatalogLists } from '@/lib/catalog-types';
import i18n from '@/lib/i18n';
import type { SelectOption } from '@/ui/select';

/**
 * Danh mục nền (loại thiết bị · vị trí · tủ · bộ phận · nhà cung cấp · nhà mạng · cổng dịch vụ)
 * — MỘT nơi hỏi, cho cả hệ thống (AD-15).
 *
 * Câu hỏi này cần ở hơn chục chỗ (thiết bị, danh mục, NAT, dải IP, đường truyền, phần mềm,
 * `use-departments`…). Rủi ro của việc chép nó không phải là gõ lại 3 dòng, mà là một bản mới
 * (hoặc một lần sửa không chạm đủ mọi bản) quên `includeInactive=true`: hai màn khi đó trả lời
 * KHÁC NHAU về cùng một danh mục, và không có gì đỏ lên.
 *
 * `includeInactive=true` là cố ý ở MỌI nơi gọi: hồ sơ cũ vẫn trỏ tới mục đã vô hiệu, và một ô
 * chọn không có mục đó sẽ hiện ô trống thay vì tên phòng ban đã giải thể. Việc lọc `active`
 * là chuyện của nơi gọi (xem `useDepartments`), không phải của tầng lấy dữ liệu.
 */
const CATALOG_LISTS_KEY = ['catalog', 'lists'] as const;

export function useCatalogLists(options?: { enabled?: boolean }): UseQueryResult<CatalogLists> {
  return useQuery({
    queryKey: CATALOG_LISTS_KEY,
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
    enabled: options?.enabled ?? true,
  });
}

/**
 * Lựa chọn cho một ô chọn TRỎ TỚI danh mục trong FORM GHI (Q-14, AD-15).
 *
 * Chỉ mục còn hiệu lực, cộng thêm đúng mục mà hồ sơ đang trỏ tới nếu mục ấy đã ngừng dùng — kèm
 * nhãn "(ngừng dùng)" mờ. Bỏ mục đó đi thì ô chọn hiện trống và người sửa tưởng hồ sơ chưa có
 * giá trị; để nguyên mọi mục thì hộp Ngừng dùng ("không form nào chọn được mục này nữa") nói
 * sai. API cũng từ chối lựa chọn MỚI trỏ vào mục đã ngừng dùng, nên đây là lớp nói trước cho người
 * dùng, không phải hàng rào duy nhất.
 *
 * KHÔNG dùng cho ô LỌC ở màn danh sách: ở đó người ta cần tra cả hồ sơ cũ theo mục đã ngừng.
 */
export function activeOptions<T extends { id: string; active: boolean }>(
  rows: readonly T[] | undefined,
  currentId: string | null | undefined,
  label: (row: T) => string,
): SelectOption[] {
  return (rows ?? [])
    .filter((row) => row.active || row.id === currentId)
    .map((row) => ({
      value: row.id,
      label: row.active
        ? label(row)
        : createElement(
            'span',
            null,
            `${label(row)} `,
            createElement('span', { className: 'muted' }, i18n.t('formErrors.retiredOption')),
          ),
    }));
}

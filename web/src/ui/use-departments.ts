import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { CatalogLists } from '@/features/catalog/catalog-types';

/**
 * Tên bộ phận đang dùng, để gợi ý cho các ô "ai đang dùng".
 *
 * Chỉ lấy mục CÒN HIỆU LỰC: phòng đã giải thể vẫn phải đọc được trong hồ sơ cũ (nên không
 * xóa), nhưng không được gợi ý cho bản ghi mới — đó chính là ý nghĩa của việc vô hiệu.
 *
 * Dùng chung `queryKey` với mọi nơi khác gọi `/api/v1/catalog`, nên mở hộp thoại lần thứ hai
 * là lấy từ cache, không hỏi lại.
 */
export function useDepartments(): string[] {
  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });
  return (lists.data?.departments ?? [])
    .filter((department) => department.active)
    .map((department) => department.name);
}

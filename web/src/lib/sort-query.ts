import type { SortingState } from '@tanstack/react-table';

/**
 * Đổi trạng thái sắp xếp của `DataTable` thành `sort=&dir=` cho API (AD-15 — mọi màn danh
 * sách dùng chung một cách nối, không màn nào tự ghép chuỗi).
 *
 * Chỉ lấy cột ĐẦU TIÊN: server whitelist đúng một cột sắp xếp, và sắp nhiều cột lồng nhau là
 * thứ chưa màn nào cần — mở ra sớm chỉ tạo ra hai cách hiểu về cùng một tham số.
 *
 * Không có cột nào đang sắp → trả chuỗi rỗng để API dùng thứ tự mặc định của nó, thay vì gửi
 * `sort=&dir=` rỗng rồi trông chờ mỗi service tự đoán ý.
 */
export function sortQuery(sorting: SortingState): string {
  const first = sorting[0];
  if (!first) return '';
  return `sort=${encodeURIComponent(first.id)}&dir=${first.desc ? 'desc' : 'asc'}`;
}

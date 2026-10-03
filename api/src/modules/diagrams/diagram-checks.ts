import type { IndexedCell } from './diagram-cells';
import type { CheckLink, Finding } from './diagram-finding';

/**
 * Luật dây của tự kiểm (AD-18): ĐỎ — `ims_link_id` không tồn tại, hai đầu link khác hai máy ở hai
 * đầu dây, hai dây gắn cùng một link; VÀNG — dây giữa hai máy kho chưa gắn link, dây giữa hai
 * site không có đường nối site. Bộ luật thuộc phần dây gắn sơ đồ cổng; khung tự kiểm gọi hàm này
 * với đúng chữ ký trên, nên chưa có luật thì trả rỗng.
 */
export function checkCables(cells: IndexedCell[], linksById: Map<string, CheckLink>): Finding[] {
  void cells;
  void linksById;
  return [];
}

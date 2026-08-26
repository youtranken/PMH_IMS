/**
 * AD-15 + convention "Phân trang": mọi danh sách sắp xếp phía SERVER qua đúng một cửa này.
 *
 * Vì sao không sắp ở client: danh sách phân trang 20 dòng/trang, sắp ở client chỉ sắp đúng
 * trang đang xem — người dùng bấm "sắp theo Tên" và tin rằng cả 300 thiết bị đã được sắp,
 * trong khi chỉ 20 dòng đổi chỗ. Sai kiểu đó không có thông báo lỗi nào, chỉ có quyết định sai.
 *
 * Danh sách cột hợp lệ là WHITELIST do module chủ khai: tên cột đi thẳng vào `ORDER BY`, nhận
 * bừa chuỗi từ query string là mở đường cho người ngoài chỉ định cột sắp xếp tuỳ ý.
 */

export type SortDir = 'asc' | 'desc';

export interface SortQuery<K extends string> {
  key: K;
  dir: SortDir;
}

/**
 * Đọc `?sort=&dir=` và kẹp về whitelist.
 *
 * Khoá lạ hoặc thiếu → rơi về `fallback` (thứ tự mặc định của màn), KHÔNG báo lỗi: người dùng
 * dán một URL cũ không nên nhận 400, chỉ nên thấy danh sách theo thứ tự mặc định.
 */
export function parseSortQuery<K extends string>(
  raw: { sort?: string; dir?: string },
  allowed: readonly K[],
  fallback: SortQuery<K>,
): SortQuery<K> {
  const key = allowed.find((candidate) => candidate === raw.sort);
  if (!key) return fallback;
  const dir: SortDir = raw.dir === 'desc' ? 'desc' : 'asc';
  return { key, dir };
}

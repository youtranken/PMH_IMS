import { asc, desc, type SQL, type SQLWrapper } from 'drizzle-orm';

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

/**
 * `ORDER BY <cột đang sắp>, <khoá chốt hạ>` — CÙNG MỘT HƯỚNG cho cả hai (26/09/2026).
 *
 * ===== VÌ SAO CẦN KHOÁ CHỐT HẠ =====
 *
 * Hai hàng cùng giá trị ở cột đang sắp thì Postgres không hứa thứ tự nào cả. Với danh sách
 * phân trang, điều đó nghĩa là sang trang 2 có thể thấy lại đúng dòng vừa xem ở trang 1, hoặc
 * mất hẳn một dòng. Mọi màn danh sách đều chốt hạ bằng `code` — cột duy nhất của chúng.
 *
 * ===== VÌ SAO HƯỚNG PHẢI ĐI THEO NHAU, VÀ ĐÂY LÀ PHẦN ĐẮT =====
 *
 * Bốn service trước 26/09 đều viết `[primary, asc(code)]` — khoá chốt hạ CỐ ĐỊNH `asc` bất kể
 * hướng chính. Khi người dùng bấm sắp giảm, câu sinh ra là `ORDER BY name DESC, code ASC`.
 *
 * Một chỉ mục btree `(name, code)` phục vụ được `(ASC, ASC)` khi quét xuôi và `(DESC, DESC)`
 * khi quét ngược. Với hình dạng TRỘN hướng `(DESC, ASC)`, Postgres phải chồng thêm một
 * `Incremental Sort` lên trên index scan để sắp lại TỪNG NHÓM hàng cùng `name`.
 *
 * Nghe như một khoản phụ phí nhỏ. Nó không nhỏ, và ca xấu nhất là cột ÍT GIÁ TRỊ KHÁC NHAU —
 * nơi "một nhóm" là một phần tư bảng. Đo trên 200.003 hàng `device`, trang 1, `LIMIT 20`:
 *
 *     ORDER BY status DESC, code ASC   → Incremental Sort, đọc 50.001 hàng →  192,08 ms
 *     ORDER BY status DESC, code DESC  → Index Scan Backward, dừng ở 20    →   0,069 ms
 *
 * Chênh 2.783 lần. Trên cột nhiều giá trị (`name`) thì nhẹ hơn nhưng vẫn thật: 98,2ms so với
 * 55,1ms ở trang cuối. Cách duy nhất còn lại để phủ cả hai hướng là dựng 38 chỉ mục thay vì 19.
 *
 * Cho khoá chốt hạ đi theo hướng chính là cách rẻ hơn hẳn, và nó KHÔNG mất gì: thứ tự giữa
 * hai hàng trùng giá trị vốn là tuỳ ý — điều cần là nó ỔN ĐỊNH, không phải nó theo chiều nào.
 *
 * Bài canh: `api/test/sort-index.spec.ts` — đọc `EXPLAIN` của đúng câu mà bốn service sinh ra,
 * cho CẢ HAI hướng, và đỏ nếu thấy một node `Sort`.
 *
 * @param column cột đang sắp.
 * @param tie khoá chốt hạ. Truyền CHÍNH `column` khi người dùng đang sắp theo đúng cột đó —
 *   so bằng danh tính đối tượng, vì `pgTable` dựng mỗi cột đúng một lần nên `t.code === t.code`
 *   luôn đúng. Nhờ vậy không nơi gọi nào phải nhớ tự viết `sort.key === 'code' ? …` nữa (và
 *   `service-account` thì đã quên: nó sinh ra `ORDER BY code DESC, code ASC`).
 */
export function orderByStable(dir: SortDir, column: SQLWrapper, tie: SQLWrapper): SQL[] {
  const step = dir === 'desc' ? desc : asc;
  return column === tie ? [step(column)] : [step(column), step(tie)];
}

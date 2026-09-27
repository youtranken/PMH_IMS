/**
 * Phép tính phân trang dùng chung (AD-15) — hàm THUẦN, kiểm bằng bảng dữ liệu ở `paging.test.ts`.
 *
 * Mọi màn danh sách phải kẹp trang theo `total` mới nhất: xoá dòng cuối của trang cuối, hoặc
 * mở `?page=99`, mà không kẹp thì bảng báo "41–40 của 40" rồi rơi vào câu rỗng "chưa có dữ
 * liệu" trong khi còn 40 dòng ở các trang trước.
 */

/** Số trang cuối — danh sách rỗng vẫn có "trang 1", không bao giờ là trang 0. */
export function lastPageOf(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}

/**
 * Kéo số trang về khoảng còn tồn tại.
 *
 * Đang ở trang 5 rồi lọc còn 3 dòng mà giữ nguyên trang 5 thì bảng rỗng trơn — người dùng
 * kết luận là không có dòng nào, trong khi có ba dòng ở trang 1.
 */
export function clampPage(page: number, total: number, limit: number): number {
  return Math.min(Math.max(1, page), lastPageOf(total, limit));
}

/** Một ô trong dãy số trang: số trang, hoặc dấu "…" cho khoảng bị lược. */
export type PageWindowItem = number | 'gap';

/**
 * Dãy số trang cho thanh phân trang: luôn có trang đầu, trang cuối, và `radius` trang hai bên
 * trang hiện tại; phần còn lại gộp thành "…" (vd `1 … 4 5 6 … 20`).
 *
 * Một khoảng lược CHỈ CÓ MỘT TRANG thì in luôn số trang đó: "1 … 3" tốn đúng chỗ của "1 2 3"
 * mà bắt người dùng đoán cái "…" giấu mấy trang.
 */
export function pageWindow(page: number, lastPage: number, radius = 1): PageWindowItem[] {
  const last = Math.max(1, lastPage);
  const current = Math.min(Math.max(1, page), last);
  const from = Math.max(1, current - radius);
  const to = Math.min(last, current + radius);

  const out: PageWindowItem[] = [];
  if (from > 1) {
    out.push(1);
    if (from === 3) out.push(2);
    else if (from > 3) out.push('gap');
  }
  for (let n = from; n <= to; n += 1) out.push(n);
  if (to < last) {
    if (to === last - 2) out.push(last - 1);
    else if (to < last - 2) out.push('gap');
    out.push(last);
  }
  return out;
}

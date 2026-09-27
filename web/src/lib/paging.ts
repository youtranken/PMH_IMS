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

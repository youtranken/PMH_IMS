/**
 * Các mốc bề ngang mà JS phải vẽ KHÁC đi (thẻ thay bảng, ô chọn thay danh sách…), mỗi mốc một
 * tên. Chuỗi PHẢI trùng y hệt một `@media` trong `css/` — lệch một pixel là có dải bề ngang mà
 * JS và CSS dựng hai bố cục khác nhau (`breakpoints.test.ts` đọc CSS thật để canh).
 *
 * Màn mới cần đổi bố cục theo bề ngang thì chọn một mốc ở đây, không tự viết chuỗi query.
 */
export const BREAKPOINTS = {
  /** Điện thoại: bảng thành thẻ gọn (`.list-card*`), thanh lọc gập, khối dashboard rút gọn. */
  cards: '(max-width: 600px)',
  /** Rất hẹp: thanh thời hạn đổi nhãn hai đầu sang chữ ngắn. */
  tight: '(max-width: 480px)',
  /** Thẻ định danh ở trang chi tiết thu gọn (`.rail-card`). */
  railCollapse: '(max-width: 680px)',
  /** Sidebar thành drawer, trang chi tiết / két chuyển bố cục một cột. */
  narrow: '(max-width: 900px)',
} as const;

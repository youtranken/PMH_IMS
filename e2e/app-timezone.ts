/**
 * Múi giờ của ứng dụng — MỘT bản, dùng cho cả cấu hình Playwright lẫn helper dựng ngày.
 *
 * ===== VÌ SAO TÁCH RA MỘT FILE RIÊNG =====
 *
 * Chuỗi này phải xuất hiện ở HAI nơi hoàn toàn khác nhau về vòng đời:
 *
 *   · `playwright.config.ts` → `timezoneId`, ghim đồng hồ của TRÌNH DUYỆT;
 *   · `tests/helpers.ts` → `isoInDays()`, ghim đồng hồ của TIẾN TRÌNH chạy bài kiểm.
 *
 * Hai đồng hồ ấy phải khớp nhau, nếu không fixture dựng ở một múi giờ còn huy hiệu được tính
 * ở múi giờ khác — đúng lỗi làm `expiry-thresholds-live` đỏ 7 tiếng mỗi ngày (24/09). Chép
 * chuỗi ra hai chỗ là để ngỏ khả năng ai đó sửa một nơi.
 *
 * File nằm NGOÀI `tests/` để `playwright.config.ts` nạp được nó mà không kéo theo
 * `@playwright/test` và cả bộ helper vào lúc đọc cấu hình.
 */
export const APP_TIMEZONE = 'Asia/Ho_Chi_Minh';

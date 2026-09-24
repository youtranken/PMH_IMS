/**
 * CỔNG CANH CHÍNH CÁI GHIM MÚI GIỜ CỦA JEST (24/09/2026).
 *
 * `jest.config.js` đặt `process.env.TZ = 'Asia/Ho_Chi_Minh'` ngay ở đầu file — trước khi
 * framework kịp đụng `Date`, vì Node ghi nhớ múi giờ ở lần dùng `Date` ĐẦU TIÊN.
 *
 * Nếu dòng ấy hỏng thì **không gì đỏ**: bộ kiểm lặng lẽ chuyển sang giờ của máy, và trên máy
 * chủ CI Ubuntu (mặc định UTC) nó vẫn XANH trong khi thôi không còn canh logic ngày-địa-phương
 * mà `today.ts` sinh ra. Một hàng rào tự tắt trong im lặng rồi in màu xanh — đúng hình dạng
 * "cổng khớp đúng số không chuỗi" mà repo này đã dựng nhầm nhiều lần.
 *
 * Bản anh em bên web: `web/src/test/timezone-pin.test.ts`. Hai tầng, cùng một luật.
 */
describe('múi giờ của bộ kiểm API', () => {
  /*
   * Nhận CẢ HAI tên: `Asia/Saigon` là tên IANA cũ, `Asia/Ho_Chi_Minh` là tên hiện hành, và
   * bản ICU đi kèm Node quyết định trả về cái nào — đo 24/09 trên Windows ra `Asia/Saigon`.
   * Khoá một chuỗi ở đây là dựng lại đúng cái bệnh "xanh máy này, đỏ máy kia".
   */
  const APP_TZ = ['Asia/Ho_Chi_Minh', 'Asia/Saigon'];

  it('chạy ở múi giờ ứng dụng, không theo giờ của máy', () => {
    expect(APP_TZ).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('lệch UTC đúng +7 cả mùa đông lẫn mùa hè — vế HÀNH VI', () => {
    // Tên đúng mà dữ liệu múi giờ thiếu (ảnh Node cắt gọn ICU) thì mọi phép tính rơi về UTC
    // trong khi cái tên vẫn đúng. Ô này hỏi thứ không phụ thuộc bản ICU.
    expect(new Date('2026-01-15T00:00:00Z').getHours()).toBe(7);
    // Việt Nam không có giờ mùa hè — giữa năm vẫn +7, không phải +8.
    expect(new Date('2026-07-15T00:00:00Z').getHours()).toBe(7);
  });
});

import { describe, expect, it } from 'vitest';

/**
 * CỔNG CANH CHÍNH CÁI GHIM MÚI GIỜ.
 *
 * ===== VÌ SAO MỘT DÒNG CẤU HÌNH CẦN MỘT BÀI KIỂM =====
 *
 * `vite.config.ts` đặt `test.env.TZ = 'Asia/Ho_Chi_Minh'`. Nếu dòng ấy hỏng — đổi tên tuỳ
 * chọn ở bản Vitest sau, ai đó dọn "cấu hình thừa", hoặc worker đụng `Date` trước khi biến
 * môi trường kịp có hiệu lực — thì **không gì đỏ**. Bộ kiểm lặng lẽ chuyển sang chạy theo
 * giờ của máy, và trên máy chủ CI Ubuntu (mặc định UTC) nó sẽ XANH trong khi thôi không còn
 * canh logic ngày-địa-phương nữa.
 *
 * Đó đúng hình dạng "cổng khớp đúng số không chuỗi" mà repo này đã dựng nhầm nhiều lần: một
 * hàng rào tự tắt trong im lặng rồi in ra màu xanh. Nên cái ghim phải có người canh, và đây
 * là người đó.
 *
 * ===== HỎI `Intl`, KHÔNG HỎI `process.env.TZ` =====
 *
 * `process.env.TZ` chỉ nói ai đó đã GÁN gì; nó không nói Node có THẬT SỰ theo hay không —
 * mà cái nhầm đáng lo nhất chính là gán quá muộn, sau khi Node đã ghi nhớ múi giờ. `Intl`
 * trả lời múi giờ đang có hiệu lực, tức thứ mọi phép `new Date(...)` trong bài đang dùng.
 */
describe('múi giờ của bộ kiểm', () => {
  /**
   * HAI cái tên, cùng một múi giờ — và đó không phải chuyện vặt.
   *
   * `Asia/Saigon` là tên IANA cũ, `Asia/Ho_Chi_Minh` là tên hiện hành. Bản ICU đi kèm Node
   * quyết định `resolvedOptions()` trả về cái nào, và **bản trên Windows khác bản trên
   * Ubuntu**: đo trên Windows ra `Asia/Saigon` dù đã ghim `Asia/Ho_Chi_Minh`.
   *
   * Khoá đúng một chuỗi ở đây là dựng lại đúng cái bệnh vừa chữa — một bài xanh trên máy này
   * và đỏ trên máy kia, vì lý do chẳng liên quan gì tới thứ nó canh. Nhận cả hai tên, rồi để
   * hai ô dưới hỏi phần HÀNH VI, thứ không phụ thuộc bản ICU nào cả.
   */
  const APP_TZ = ['Asia/Ho_Chi_Minh', 'Asia/Saigon'];

  it('chạy ở múi giờ ứng dụng, không theo giờ của máy', () => {
    expect(APP_TZ).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('lệch UTC đúng +7 giờ — vế đo được, không chỉ đo cái tên', () => {
    /*
     * Tên múi giờ đúng mà dữ liệu múi giờ thiếu (ảnh Node cắt gọn `full-icu`) thì `Intl` vẫn
     * trả về cái tên ấy trong khi mọi phép tính rơi về UTC. Ô này hỏi phần HÀNH VI.
     */
    const mocDong = new Date('2026-01-15T00:00:00Z');
    expect(mocDong.getHours()).toBe(7);

    // Việt Nam không có giờ mùa hè — giữa năm phải vẫn +7, không phải +8.
    const mocHe = new Date('2026-07-15T00:00:00Z');
    expect(mocHe.getHours()).toBe(7);
  });

  it('ngày địa phương và ngày UTC LỆCH NHAU lúc 00:30 giờ VN — chính cái bẫy đang canh', () => {
    /*
     * Tái dựng đúng khoảnh khắc từng làm `expiry-thresholds-live` đỏ: 00:30 giờ VN thì UTC
     * còn là hôm trước. Ô này khoá lại sự thật ấy để người đọc sau không phải tự dựng
     * lại bối cảnh mới hiểu vì sao có cái ghim ở `vite.config.ts`.
     */
    const nuaDem = new Date('2026-09-23T17:30:00Z'); // = 00:30 ngày 24/09 giờ VN
    expect(nuaDem.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(nuaDem.toLocaleDateString('sv')).toBe('2026-09-24');
  });
});

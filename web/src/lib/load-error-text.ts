import { ApiError } from '@/lib/api-client';

/**
 * Một lượt tải hỏng thì NÓI NÓ HỎNG VÌ SAO — không gộp mọi nguyên nhân vào một câu.
 *
 * ===== CÂU CHUNG CHUNG LÀ MỘT CÂU TRẢ LỜI SAI =====
 *
 * Tới 12/09, `LoadError` không nhận `error` gì cả: 38 chỗ gọi trên toàn bộ web đều in ra đúng
 * "Không tải được dữ liệu." kèm nút "Thử lại". Nghĩa là bốn tình huống KHÁC HẲN nhau — và cần
 * bốn hành động khác hẳn nhau — đọc ra y như một:
 *
 *   · 403 — không có quyền. Bấm "Thử lại" cả ngày cũng vậy; việc cần làm là đi hỏi Quản trị.
 *   · 404 — hồ sơ đã bị xóa, hoặc link đã cũ. Việc cần làm là quay lại danh sách.
 *   · mất mạng — dây rớt, VPN tụt. Việc cần làm là xem lại mạng, rồi Thử lại thì ăn ngay.
 *   · 500 — máy chủ sập. Việc cần làm là báo IT.
 *
 * Trong khi đó API đã gửi sẵn một câu TIẾNG VIỆT cho gần như mọi lỗi (convention Error của
 * spine, và `errorMessage()` ở `lib/api.ts` đã đọc nó từ lâu cho toast). `LoadError` vứt đi.
 *
 * ===== VÌ SAO TÁCH RA HÀM THUẦN =====
 *
 * Để bảng nguyên nhân → câu chữ có bài kiểm chạy được mà không phải dựng React, và để hàm
 * không cần `t`: nó trả về MỘT hình dạng, nơi gọi tự chọn giữa `text` và `key`.
 * (`tsconfig.app.json` không bật `strict`, nên union phân biệt bằng cờ không thu hẹp được —
 * `{ text, key }` là lối repo đã chọn từ trước.)
 */
export interface LoadErrorText {
  /** Câu API đã gửi, sẵn sàng hiện. `null` = không có, dùng `key`. */
  text: string | null;
  /** Khóa i18n dùng khi `text` rỗng. Luôn có giá trị, kể cả khi `text` đã có. */
  key: string;
}

export function describeLoadError(error: unknown): LoadErrorText {
  /*
   * `undefined` = nơi gọi KHÔNG có lỗi trong tay (bài kiểm, hoặc một nhánh hỏng tự dựng).
   * Giữ nguyên câu cũ ở đây, đừng đoán thành "mất mạng": đoán sai thì tệ hơn nói chung chung.
   */
  if (error === undefined || error === null) return { text: null, key: 'app.loadError' };

  if (error instanceof ApiError) {
    const body = error.body as { message?: string } | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    /*
     * Câu của API đi trước MỌI câu ở đây — nó biết chuyện cụ thể ("Dải mạng không tồn tại
     * hoặc đã bị xóa."), còn ta chỉ biết con số HTTP. Trừ 500: `global-exception.filter.ts`
     * cố ý trả một câu chung chung để không lộ nội bộ, nên lấy nó về cũng không thêm gì.
     */
    if (message && error.status < 500) return { text: message, key: 'app.loadError' };

    if (error.status === 403) return { text: null, key: 'app.forbidden' };
    if (error.status === 404) return { text: null, key: 'app.notFoundData' };
    if (error.status >= 500) return { text: null, key: 'app.serverError' };
    return { text: null, key: 'app.loadError' };
  }

  /*
   * Không phải `ApiError` thì lượt gọi chưa bao giờ tới được máy chủ: `fetch` chỉ reject
   * (TypeError) khi mạng đứt, DNS hỏng, hoặc kết nối bị chặn. Đây là chỗ khóa `app.serverUnreachable`
   * sống lại — nó nằm chết trong `vi.ts` từ đầu dự án vì không ai có đường dẫn tới nó.
   */
  return { text: null, key: 'app.serverUnreachable' };
}

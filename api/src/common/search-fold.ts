/**
 * GẤP DẤU TIẾNG VIỆT — một bản, cho cả so nhãn, sinh mã lẫn tìm kiếm (B-01, 25/09/2026).
 *
 * ===== VÌ SAO FILE NÀY RA ĐỜI =====
 *
 * Trước 25/09 repo có HAI bản gấp dấu viết tay, không bản nào dùng chung (AD-15):
 *
 *   · `import-plan.ts` — `stripDiacritics`, để khớp tên cột trong file Excel;
 *   · `service-account-rules.ts` — bốn dòng y hệt nằm giữa `codeFromLogin`.
 *
 * Và chỗ CẦN nó nhất thì không có: ô tìm kiếm. Đo trên 30.000 thiết bị thật (§13.3 của sổ rà
 * soát): gõ `Máy trạm` ra 2.500 dòng, gõ `may tram` ra **0 dòng** — và màn hình trả lời
 * "Chưa có thiết bị nào khớp bộ lọc", tức khẳng định một điều sai. 7.500/30.000 hồ sơ vô
 * hình với người gõ không dấu. Người Việt gõ không dấu là chuyện thường ngày.
 *
 * ===== HAI BẢN ANH EM, KHÔNG IMPORT ĐƯỢC NHAU =====
 *
 * Cùng phép gấp dấu này còn phải sống ở `web/src/lib/search-fold.ts` và ở hàm `ims_norm(text)`
 * trong Postgres (migration 0052). `api/`, `web/` là hai dự án npm độc lập và DB là thế giới
 * thứ ba — không có đường import nào bắc qua. Thứ dùng chung được là DỮ LIỆU:
 * `ops/search-fold-cases.json`, và ba bộ kiểm cùng đọc nó. Xem `search-fold.spec.ts`.
 *
 * Quan trọng: `strip`/`fold` KHÔNG đụng tới `% _ \` — thoát ký tự đại diện của LIKE là việc
 * của `escapeLike` trong `sql.ts`. Hai việc rời nhau, và phải rời nhau.
 */

/**
 * Dải dấu thanh/dấu phụ Unicode. Dựng bằng `new RegExp` từ CHUỖI ESCAPE, không viết ký tự tổ
 * hợp trần trong mã nguồn: editor hay formatter nào chuẩn hóa/nuốt mất mấy ký tự đó là toàn
 * bộ việc gấp dấu im lặng ngừng hoạt động (bài học code review Epic 2).
 */
const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');

/**
 * Bỏ dấu tiếng Việt, GIỮ NGUYÊN hoa/thường.
 *
 * `đ`/`Đ` phải thay riêng: chúng không phải ký tự tổ hợp nên `NFD` không tách được dấu gạch
 * ngang ra khỏi thân chữ.
 *
 * CHỈ để so nhãn / sinh mã / tìm kiếm — KHÔNG dùng cho dữ liệu lưu xuống DB.
 */
export function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Khóa so khớp khi TÌM KIẾM: bỏ dấu rồi hạ chữ thường.
 *
 * Phải trả về đúng thứ `ims_norm(text)` của Postgres trả về — đó là cả điểm của nó. Kiểm
 * chứng đối chiếu nằm ở `api/test/search-norm.spec.ts`, chạy trên DB thật.
 */
export function foldSearch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

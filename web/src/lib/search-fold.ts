/**
 * GẤP DẤU TIẾNG VIỆT — bản dùng cho mọi chỗ LỌC TẠI CHỖ trên trình duyệt.
 *
 * ===== DÙNG Ở ĐÂU =====
 *
 * Sáu màn lọc mảng đã tải sẵn, không gọi API: bảng lệnh (`command-palette`), Kho thanh lý,
 * chọn dịch vụ/cổng, Ma trận truy cập, Trang chủ Kho mật khẩu, và `suggest-input`. Viết
 * `x.toLowerCase().includes(term)` thì gõ `thiet` không ra `Thiết bị` — cùng lỗi tìm không dấu
 * mà tầng SQL đã chặn bằng `searchNormLike`, chỉ là ở tầng trình duyệt.
 *
 * Mọi chỗ lọc mảng tại chỗ phải đi qua `foldSearch` ở CẢ HAI VẾ — vế dữ liệu và vế từ khóa.
 * Gấp một vế thôi thì gõ `Thiết` lại không ra `Thiết bị`, tức chữa xong bệnh này thì mắc
 * bệnh ngược lại.
 *
 * ===== HAI BẢN ANH EM =====
 *
 * `api/src/common/search-fold.ts` (JS) và `ims_norm(text)` trong Postgres (migration 0052)
 * phải cho KẾT QUẢ Y HỆT. Ba nơi không import được nhau — `web/tsconfig.app.json` chỉ
 * `include: ["src"]`, `api/` là dự án npm riêng, DB là thế giới thứ ba. Thứ dùng chung được
 * là DỮ LIỆU: `ops/search-fold-cases.json`. Xem `src/test/search-fold.test.ts`.
 *
 * KHÔNG đụng tới `% _ \`: ở tầng web không có LIKE nào để mà thoát, và giữ cho hai bản giống
 * nhau quan trọng hơn sự tiện tay.
 */

/**
 * Dải dấu thanh/dấu phụ Unicode. Dựng bằng `new RegExp` từ CHUỖI ESCAPE, không viết ký tự tổ
 * hợp trần trong mã nguồn: editor hay formatter nào chuẩn hóa/nuốt mất mấy ký tự đó là toàn
 * bộ việc gấp dấu im lặng ngừng hoạt động.
 */
const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');

/** Bỏ dấu tiếng Việt, GIỮ NGUYÊN hoa/thường. `đ`/`Đ` không phải ký tự tổ hợp nên thay riêng. */
export function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Khóa so khớp khi tìm kiếm: bỏ dấu rồi hạ chữ thường. Bằng `ims_norm(text)` bên Postgres. */
export function foldSearch(value: string): string {
  return stripDiacritics(value).toLowerCase();
}

/**
 * Đoạn `[đầu, cuối)` trong `text` GỐC khớp với `q` theo phép gấp dấu — để tô đậm đúng chữ
 * người dùng đang nhìn. `null` khi không khớp, hoặc khi một ký tự gấp ra độ dài khác 1 (chỉ
 * số lệch thì tô sai chỗ — thà không tô).
 */
export function foldedMatchRange(text: string, q: string): [number, number] | null {
  const needle = foldSearch(q.trim());
  if (!needle) return null;
  const chars = Array.from(text);
  const folded = chars.map((c) => foldSearch(c));
  if (folded.some((c) => c.length !== 1) || chars.length !== text.length) return null;
  const at = folded.join('').indexOf(needle);
  return at < 0 ? null : [at, at + needle.length];
}

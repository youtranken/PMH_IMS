/**
 * Đọc một tham số vận hành thành SỐ — hàm thuần, tách khỏi service để kiểm bằng bảng dữ liệu.
 *
 * ===== BẪY CHUỖI RỖNG =====
 *
 * `Number('')` là `0`, và `Number.isFinite(0)` là `true`. Nên phép kiểm quen thuộc
 *
 *     const value = Number(raw);
 *     if (!Number.isFinite(value)) return fallback;
 *
 * cho chuỗi RỖNG đi lọt thành số 0 — im lặng. Admin xóa nội dung một ô trên màn Tham số rồi
 * bấm Lưu là đủ: `session.absolute_hours = 0` nghĩa là phiên hết hạn tức thì, cả công ty
 * không đăng nhập được, và không có dòng lỗi nào để lần ra. Cùng bẫy với `[]` (`Number([])`
 * cũng là 0) và `true` (`Number(true)` là 1).
 *
 * Trả về CẢ cờ `fellBack` chứ không chỉ con số: thiếu nó thì "cấu hình đúng bằng mặc định" và
 * "cấu hình hỏng nên rơi về mặc định" trông giống hệt nhau ở nơi gọi, và không ai kêu lên
 * được. Cùng hình dạng với `useDepartments` bên web.
 */
export function parseConfigNumber(
  raw: unknown,
  fallback: number,
): { value: number; fellBack: boolean } {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, fellBack: false } : { value: fallback, fellBack: true };
  }
  /*
   * CHỈ chuỗi mới được ép kiểu. `null`, `undefined`, `boolean`, mảng, object đều rơi thẳng —
   * không có cấu hình hợp lệ nào mang những kiểu đó, và ép chúng chỉ tạo ra số vô nghĩa.
   */
  if (typeof raw !== 'string') return { value: fallback, fellBack: true };

  const text = raw.trim();
  if (text === '') return { value: fallback, fellBack: true };

  const value = Number(text);
  return Number.isFinite(value) ? { value, fellBack: false } : { value: fallback, fellBack: true };
}

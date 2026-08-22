/**
 * Escape ký tự đặc biệt của LIKE/ILIKE — search chứa % _ \ không thành wildcard
 * (bài học 1.5; dùng chung users/assets, Epic 3 booking dùng tiếp).
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * Mã lỗi SQLSTATE của Postgres (vd `23503` khóa ngoại, `23505` trùng khóa) — đào qua chuỗi
 * `cause` chứ không đọc thẳng `error.code`.
 *
 * Vì sao: drizzle BỌC lỗi pg trong `DrizzleQueryError` ("Failed query: …") và để lỗi gốc ở
 * `cause`. Đọc `error.code` ở lớp ngoài luôn ra `undefined`, nên mọi câu "dịch lỗi DB thành
 * tiếng Việt" đều rơi xuống 500. (Đúng lỗi E2E story 2.1 bắt được: xóa site đang có tủ trả
 * 500 thay vì 409 kèm gợi ý vô hiệu hóa.)
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Vi phạm khóa ngoại — "đang có dữ liệu khác trỏ tới, không xóa được". */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** Vi phạm ràng buộc duy nhất — trùng mã/tên. */
export const PG_UNIQUE_VIOLATION = '23505';

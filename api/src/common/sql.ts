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

/**
 * TÊN ràng buộc bị vi phạm (vd `users_employee_code_uq`) — đào qua `cause` y như
 * `pgErrorCode`, vì drizzle bọc lỗi pg trong `DrizzleQueryError`.
 *
 * Cần khi MỘT bảng có nhiều khóa duy nhất: chỉ biết mã `23505` thì không biết ô nào đụng, và
 * đoán bừa là báo sai hẳn ô cho người dùng.
 */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Vi phạm khóa ngoại — "đang có dữ liệu khác trỏ tới, không xóa được". */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** Vi phạm ràng buộc duy nhất — trùng mã/tên. */
export const PG_UNIQUE_VIOLATION = '23505';
/**
 * Vi phạm CHECK — cũng là mã mà `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'`
 * trong trigger dùng (vd `ip_address_within_subnet` của Epic 5).
 */
export const PG_CHECK_VIOLATION = '23514';

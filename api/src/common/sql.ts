import { ConflictException } from '@nestjs/common';
import { sql, type SQL, type SQLWrapper, type Table } from 'drizzle-orm';

/**
 * Escape ký tự đặc biệt của LIKE/ILIKE — search chứa % _ \ không thành wildcard
 * (bài học 1.5; dùng chung users/assets, Epic 3 booking dùng tiếp).
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * VẾ TÌM KIẾM GẤP DẤU — một bản, sáu màn (B-01, 25/09/2026).
 *
 * ===== VẤN ĐỀ NÓ CHỮA =====
 *
 * `ILIKE` **không** gấp dấu: `SELECT 'Thiết bị họp' ILIKE '%thiet%'` trả `f`. Đo trên 30.000
 * thiết bị thật, gõ `may tram` ra **0 dòng** trong khi `Máy trạm` ra 2.500 — 7.500/30.000 hồ
 * sơ vô hình với người gõ không dấu, và màn hình còn khẳng định "Chưa có thiết bị nào khớp
 * bộ lọc". Chi tiết ở §13.3 sổ rà soát.
 *
 * ===== HAI HÌNH DẠNG, CHỌN THEO KÍCH CỠ BẢNG =====
 *
 * `searchNormLike` đọc CỘT SINH `search_norm` (migration 0052) — có chỉ mục GIN trigram nên
 * chạy được ở cỡ triệu dòng. Dùng cho 5 bảng nghiệp vụ.
 *
 * `imsNormLike` gọi `ims_norm()` ngay tại chỗ trên một cột — KHÔNG chỉ mục nào phục vụ được
 * nó, nên chỉ dùng cho bảng tra cứu nhỏ (danh mục: site, tủ, hãng, phòng ban… vài chục tới
 * vài trăm dòng). Ở cỡ ấy quét tuần tự là chuyện không đáng bàn, còn dựng cột sinh + chỉ mục
 * GIN cho mỗi bảng là trả giá mà không mua được gì.
 *
 * ===== VÌ SAO `LIKE` CHỨ KHÔNG `ILIKE` =====
 *
 * `ims_norm()` đã hạ chữ thường cả hai vế rồi. Dùng `ILIKE` ở đây là hạ chữ thường LẦN HAI —
 * vô hại về kết quả nhưng làm chỉ mục `gin_trgm_ops` trên `search_norm` không còn khớp toán
 * tử, tức là mất chỉ mục trong im lặng.
 */
export function searchNormLike(table: Table, term: string): SQL {
  return sql`${table}.search_norm LIKE ims_norm(${`%${escapeLike(term)}%`})`;
}

/**
 * Vế tìm kiếm gấp dấu TÍNH TẠI CHỖ — cho bảng tra cứu nhỏ, không có cột sinh.
 *
 * `::text` vì phần lớn cột mã/tên của danh mục là `citext`. `ims_norm` là STRICT nên cột
 * `NULL` cho ra `NULL` → không khớp, đúng y như `ILIKE` trên `NULL` trước đây.
 */
export function imsNormLike(column: SQLWrapper, term: string): SQL {
  return sql`ims_norm(${column}::text) LIKE ims_norm(${`%${escapeLike(term)}%`})`;
}

/**
 * Khoá SẮP theo thứ tự chữ tiếng Việt (a ă â b c d đ e ê …) cho cột chữ.
 *
 * Collation mặc định của DB là theo mã byte: "Điện thoại IP" rơi xuống sau "UPS" và "Kinh doanh"
 * đứng trước "Kế toán", tức danh sách dài không ở chỗ mắt người Việt tìm. `vi-x-icu` có sẵn
 * trong Postgres dựng với ICU (image `postgres:*-alpine` của compose). `::text` vì cột mã/tên
 * danh mục là `citext`. Chỉ dùng để SẮP, không dùng để so bằng.
 */
export function viOrder(column: SQLWrapper): SQL {
  return sql`${column}::text COLLATE "vi-x-icu"`;
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
const PG_UNIQUE_VIOLATION = '23505';
/** Vi phạm ràng buộc EXCLUDE — chồng port NAT, chồng dải IP. */
export const PG_EXCLUSION_VIOLATION = '23P01';
/**
 * Vi phạm CHECK — cũng là mã mà `RAISE EXCEPTION ... USING ERRCODE = 'check_violation'`
 * trong trigger dùng (vd `ip_address_within_subnet` của Epic 5).
 */
export const PG_CHECK_VIOLATION = '23514';

/**
 * Dịch một lỗi "trùng khóa duy nhất" thành `409` có câu tiếng Việt — MỘT chỗ, mười hai nơi gọi.
 *
 * ===== VÌ SAO GOM =====
 *
 * Mười hai module đều viết lại đúng bốn dòng này:
 *
 *     if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
 *       return new ConflictException({ code: '…', message: '…' });
 *     }
 *     return error;
 *
 * Phần KHÁC NHAU là `code` + `message` — dữ liệu nghiệp vụ, đúng ra phải khác nhau. Phần
 * GIỐNG NHAU là tri thức dễ sai nhất và cũng là thứ đã sai một lần: drizzle bọc lỗi pg trong
 * `DrizzleQueryError` và để lỗi gốc ở `cause`, nên đọc thẳng `error.code` luôn ra `undefined`
 * và MỌI câu dịch rơi xuống 500 (lỗi E2E story 2.1). Bản sao thứ mười ba viết tay là bản sao
 * thứ mười ba có thể quên `pgErrorCode` mà dùng `error.code`.
 *
 * Trả về `unknown` chứ không ném: nơi gọi vẫn giữ nguyên nếp `throw this.translate(error)`,
 * và lỗi không phải 23505 đi qua nguyên vẹn để tầng trên xử.
 *
 * @param constraint tên ràng buộc PHẢI khớp, khi một bảng có nhiều khóa duy nhất. Bỏ trống thì
 *   mọi 23505 trên bảng đó đều ra cùng một câu — đúng khi bảng chỉ có một khóa, và SAI (báo
 *   nhầm ô cho người dùng) khi bảng có nhiều.
 */
export function conflictOnUnique(
  error: unknown,
  body: { code: string; message: string },
  constraint?: string,
): unknown {
  if (pgErrorCode(error) !== PG_UNIQUE_VIOLATION) return error;
  if (constraint !== undefined && pgConstraint(error) !== constraint) return error;
  return new ConflictException(body);
}

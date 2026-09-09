/**
 * Dựng dòng log cho một lỗi 500 — GIỮ chẩn đoán, BỎ giá trị đã bind.
 *
 * ===== VÌ SAO CẦN =====
 *
 * drizzle-orm ≥0.36 ném `DrizzleQueryError`, và message của nó là
 *
 *     `Failed query: ${query}\nparams: ${params}`
 *
 * `params` là mảng THAM SỐ ĐÃ BIND. Một câu INSERT vào `users` mà hỏng sẽ in nguyên hash
 * Argon2, ciphertext TOTP secret, email, họ tên, số điện thoại — vào `docker logs`, tức là ra
 * ngoài ranh giới PII mà NFR-04/AD-4 dựng quanh DB. Không ai phải cố ý làm gì; chỉ cần một
 * ràng buộc bị vi phạm.
 *
 * ===== CÁCH LÀM =====
 *
 * DUCK-TYPE chính đối tượng lỗi (`query: string` + `params: unknown[]`) rồi TỰ DỰNG dòng log
 * từ `query`. Không cắt xén chuỗi `.stack` có sẵn: giá trị tham số có thể chứa xuống dòng (ô
 * mô tả nhiều dòng), nên mọi regex "che tới cuối dòng" đều để lọt phần còn lại.
 *
 * Không duck-type được thì TRẢ NGUYÊN stack. Che quá tay còn tệ hơn: nó biến mọi lỗi 500 khác
 * thành mù, ở cả body lẫn log, và không còn đường nào lần ra.
 */

/** Sâu tối đa của chuỗi `cause` — chặn cả lỗi tự trỏ vòng lẫn chuỗi bọc quá dài. */
const MAX_CAUSE_DEPTH = 5;

export function redactForLog(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];

  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    parts.push(describe(current));
    current = (current as { cause?: unknown }).cause;
  }

  if (parts.length === 0) return String(error);
  return parts.join('\n  ← nguyên nhân: ');
}

/** Một mắt xích trong chuỗi lỗi. */
function describe(error: unknown): string {
  const query = asQueryError(error);
  if (query) {
    /*
     * Dựng lại từ `query`, KHÔNG dùng `.message`/`.stack` của nó — cả hai đều đã nhúng sẵn
     * chuỗi `params:` nguyên văn.
     */
    return `Câu truy vấn hỏng (${query.params.length} tham số đã che — NFR-04): ${query.query}`;
  }

  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const suffix = typeof code === 'string' || typeof code === 'number' ? ` [code ${code}]` : '';
    return `${error.stack ?? error.message}${suffix}`;
  }

  return String(error);
}

/** Có phải lỗi truy vấn của drizzle không — nhận theo HÌNH DẠNG, không import class. */
function asQueryError(error: unknown): { query: string; params: unknown[] } | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { query?: unknown; params?: unknown };
  if (typeof candidate.query !== 'string' || !Array.isArray(candidate.params)) return null;
  return { query: candidate.query, params: candidate.params };
}

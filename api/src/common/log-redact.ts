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
  return walkCauses(error, describe, '\n  ← nguyên nhân: ');
}

/**
 * Bản MỘT DÒNG — cho `logger.warn`/`logger.error` chỉ muốn một câu, không muốn cả stack.
 *
 * ===== VÌ SAO CÓ HAI BẢN, CHỨ KHÔNG PHẢI MỘT =====
 *
 * `redactForLog` sinh ra cho lỗi 500 ở `GlobalExceptionFilter`: ở đó stack là thứ duy nhất
 * còn lại để lần ra, nên phải giữ. Nhưng 13 chỗ khác trong repo chỉ đang ghi một dòng cảnh
 * báo ("khối sắp-hết-hạn lỗi: …"), và nhét nguyên stack vào đó sẽ làm log ồn tới mức không
 * ai đọc — mà log không ai đọc thì bằng không có log.
 *
 * Nên chúng nhận bản ngắn. Ranh giới giữa hai bản là ĐỘ DÀI, không phải mức độ che: cả hai
 * che `params` y như nhau, vì đó mới là chỗ PII rò ra.
 *
 * ===== VÌ SAO KHÔNG ĐỂ CHÚNG TỰ VIẾT `.message` =====
 *
 * Đó chính là trạng thái trước 11/09: 13 chỗ viết `(error as Error).message`, và với
 * `DrizzleQueryError` thì `.message` là `Failed query: <sql>\nparams: <THAM SỐ ĐÃ BIND>` —
 * hash Argon2, ciphertext TOTP secret, email, họ tên, số điện thoại rơi thẳng vào
 * `docker logs`, ngoài ranh giới PII mà NFR-04/AD-4 dựng quanh DB. Không ai phải cố ý làm
 * gì; chỉ cần một ràng buộc bị vi phạm ở một câu INSERT vào `users`.
 *
 * Vẫn đi hết chuỗi `cause`: một lỗi bọc ngoài thường chẳng nói gì ("Ghi audit thất bại"), và
 * mắt xích bên trong mới cho biết đó là lỗi DB hay lỗi mạng.
 */
export function redactMessage(error: unknown): string {
  return walkCauses(error, describeShort, ' ← nguyên nhân: ');
}

/** Đi hết chuỗi `cause`, chặn cả lỗi tự trỏ vòng lẫn chuỗi bọc quá dài. */
function walkCauses(
  error: unknown,
  render: (link: unknown) => string,
  separator: string,
): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];

  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    parts.push(render(current));
    current = (current as { cause?: unknown }).cause;
  }

  if (parts.length === 0) return String(error);
  return parts.join(separator);
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

/**
 * Che ĐỊA CHỈ EMAIL trong một chuỗi sắp ghi ra log.
 *
 * Khác hẳn hai hàm trên, và hai việc này KHÔNG được gộp:
 *   · `redactMessage`/`redactForLog` che THAM SỐ ĐÃ BIND của một lỗi truy vấn;
 *   · hàm này che email trong một chuỗi bất kỳ — lỗi SMTP hay nhúng nguyên địa chỉ người
 *     nhận vào message, và chuỗi đó còn đi tiếp vào `outbox.fail_reason` chứ không chỉ ra log.
 *
 * Chỉ dùng ở đường MAIL/JOB. Không bọc nó quanh mọi dòng log: `audit_log.actor` là email và
 * nó có mặt trong log một cách CÓ CHỦ Ý — che hết thì mất luôn đường lần ra ai làm gì.
 *
 * Trước 11/09 hàm này nằm riêng trong `worker/worker.ts`, cạnh đúng một chỗ dùng. Chuyển về
 * đây để "những gì phải chà trước khi ghi log" có MỘT nhà (AD-15), và để chỗ dùng ghép được
 * hai lớp: `redactPii(redactMessage(err))`.
 */
export function redactPii(message: string): string {
  return message.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, '[email]');
}

/** Một mắt xích, bản MỘT DÒNG: bỏ stack, giữ nguyên phần che `params`. */
function describeShort(error: unknown): string {
  const query = asQueryError(error);
  if (query) {
    return `Câu truy vấn hỏng (${query.params.length} tham số đã che — NFR-04)`;
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const suffix = typeof code === 'string' || typeof code === 'number' ? ` [code ${code}]` : '';
    return `${error.message}${suffix}`;
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

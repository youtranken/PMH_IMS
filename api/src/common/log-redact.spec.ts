import { redactForLog } from './log-redact';

/**
 * LỖI 500 KHÔNG ĐƯỢC MANG HASH MẬT KHẨU RA FILE LOG.
 *
 * ===== BẪY =====
 *
 * `GlobalExceptionFilter` ghi `exception.stack ?? exception.message` cho mọi lỗi ≥500. Với
 * drizzle-orm ≥0.36, lỗi truy vấn là `DrizzleQueryError`, và constructor của nó dựng message
 * đúng như sau (`node_modules/drizzle-orm/errors.cjs`):
 *
 *     `Failed query: ${query}\nparams: ${params}`
 *
 * `params` là MẢNG THAM SỐ ĐÃ BIND. Nên một câu INSERT vào `users` mà hỏng — vi phạm ràng
 * buộc, kiểu cột sai, một bug ở tầng trên — sẽ in ra log: hash Argon2, ciphertext của TOTP
 * secret, email, họ tên, số điện thoại, ngày sinh. Toàn bộ, nguyên văn, trong một dòng.
 *
 * Log không cùng vùng bảo vệ với DB: nó chảy ra `docker logs`, ra file trên host, ra bất kỳ
 * thứ gì gom log, với vòng đời và danh sách người đọc khác hẳn. NFR-04 dựng ranh giới PII
 * quanh DB; đường này đi vòng qua ranh giới đó mà không ai phải cố ý làm gì.
 *
 * ===== VÌ SAO KHÔNG CHỈ CHẶN Ở `.message` =====
 *
 * `.stack` chứa message NGUYÊN VĂN ở dòng đầu, nên che mỗi `.message` là vô nghĩa. Và giá trị
 * tham số có thể chứa xuống dòng (ô mô tả nhiều dòng), nên một regex "xóa tới cuối dòng" sẽ
 * để lọt phần còn lại. Vì vậy hàm này DUCK-TYPE chính đối tượng lỗi (`query` + `params`) rồi
 * TỰ DỰNG dòng log từ `query`, không bao giờ chạm vào chuỗi có sẵn của nó.
 */
describe('redactForLog — SQL ra log, tham số thì không', () => {
  /** Dựng đúng hình dạng `DrizzleQueryError` mà không phải import class riêng của drizzle. */
  function queryError(query: string, params: unknown[], cause?: Error): Error {
    // Nội suy mảng đúng như drizzle làm — `${params}` trong template literal là `join(',')`.
    const error = new Error(`Failed query: ${query}\nparams: ${params.join(',')}`);
    Object.assign(error, { query, params, cause });
    return error;
  }

  const ARGON2 = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$3aVn8mCVCFCTsJ2ZmZ0N4Q';

  it('lỗi truy vấn: giữ câu SQL, KHÔNG in một tham số nào', () => {
    const text = redactForLog(
      queryError('insert into "users" ("email", "password_hash") values ($1, $2)', [
        'nguyen.van.a@pmh.com.vn',
        ARGON2,
      ]),
    );

    expect(text).toContain('insert into "users"');
    expect(text).not.toContain(ARGON2);
    expect(text).not.toContain('nguyen.van.a@pmh.com.vn');
    // Vẫn phải nói RÕ là đã che, và che bao nhiêu — người đọc log cần biết mình đang thiếu gì.
    expect(text).toMatch(/2 tham số đã che/);
  });

  it.each([
    ['hash Argon2', ARGON2],
    ['ciphertext TOTP', 'k1:9f3a2b1c8d7e6f5a4b3c2d1e0f9a8b7c'],
    ['email', 'ke.toan@pmh.com.vn'],
    ['số điện thoại', '0912345678'],
    ['giá trị nhiều dòng — regex "tới cuối dòng" sẽ để lọt', 'dòng một\ndòng hai\ndòng ba'],
  ])('không rò %s', (_name, secret) => {
    const text = redactForLog(queryError('update "users" set "x" = $1', [secret]));
    expect(text).not.toContain(secret);
  });

  /**
   * Nguyên nhân gốc (mã lỗi Postgres, tên ràng buộc) là thứ ĐÁNG GIÁ NHẤT trong cả dòng log —
   * che sạch thì cái filter này biến một lỗi chẩn đoán được thành "Internal server error" cả ở
   * body LẪN ở log, và không còn đường nào lần ra.
   */
  it('giữ nguyên nhân gốc: mã lỗi và tên ràng buộc của Postgres', () => {
    const cause = new Error('duplicate key value violates unique constraint "users_email_uq"');
    Object.assign(cause, { code: '23505' });
    const text = redactForLog(queryError('insert into "users" ...', [ARGON2], cause));

    expect(text).toContain('users_email_uq');
    expect(text).toContain('23505');
    expect(text).not.toContain(ARGON2);
  });

  /**
   * Vế đối chứng, và là vế dễ hỏng nhất: 500 KHÔNG phải lỗi truy vấn vẫn phải giữ nguyên
   * stack. Một hàm che quá tay sẽ xanh ở mọi bài trên mà làm mù toàn bộ phần còn lại của hệ.
   */
  it('lỗi thường: giữ nguyên stack, không cắt xén gì', () => {
    const plain = new Error('Không mở được két: thiếu IMS_MASTER_KEY');
    const text = redactForLog(plain);

    expect(text).toContain('Không mở được két: thiếu IMS_MASTER_KEY');
    expect(text).toContain('log-redact.spec.ts');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['chuỗi', 'hỏng ở đâu đó'],
    ['số', 42],
    ['object trần', { a: 1 }],
  ])('thứ ném ra không phải Error (%s) vẫn ra chuỗi, không tự ném', (_name, thrown) => {
    expect(typeof redactForLog(thrown)).toBe('string');
  });

  /**
   * Drizzle bọc lỗi pg vào `cause`, nhưng tầng khác có thể bọc thêm một lớp nữa. Che chỉ ở
   * lớp ngoài cùng thì một `new Error('ghi user hỏng', { cause: queryError })` là đủ để tham
   * số chui ra qua stack của `cause`.
   */
  it('lỗi truy vấn nằm trong `cause` của một lỗi khác cũng bị che', () => {
    const inner = queryError('insert into "users" ...', [ARGON2]);
    const outer = new Error('Ghi hồ sơ người dùng thất bại', { cause: inner });

    const text = redactForLog(outer);
    expect(text).toContain('Ghi hồ sơ người dùng thất bại');
    expect(text).not.toContain(ARGON2);
  });

  /** Chuỗi `cause` tự trỏ vào chính nó không được làm filter treo. */
  it('vòng lặp `cause` không làm treo', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.assign(a, { cause: b });
    expect(() => redactForLog(a)).not.toThrow();
  });
});

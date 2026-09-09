import { ConflictException } from '@nestjs/common';
import {
  conflictOnUnique,
  escapeLike,
  pgConstraint,
  pgErrorCode,
  PG_FOREIGN_KEY_VIOLATION,
} from './sql';

describe('escapeLike — ký tự đặc biệt của LIKE không thành wildcard', () => {
  it.each([
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['C:\\temp', 'C:\\\\temp'],
    ['SW-CORE-01', 'SW-CORE-01'],
  ])('%s → %s', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});

describe('pgErrorCode — đào mã SQLSTATE qua chuỗi cause', () => {
  it('đọc được mã ở ngay lớp ngoài (lỗi pg thô)', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });

  /**
   * drizzle bọc lỗi pg trong DrizzleQueryError và để lỗi gốc ở `cause`. Không đào thì mọi
   * lỗi ràng buộc DB rơi xuống 500 — đúng lỗi E2E story 2.1 bắt được (xóa site đang có tủ).
   */
  it('đọc được mã khi drizzle bọc lỗi pg vào cause', () => {
    const pgError = Object.assign(new Error('violates foreign key constraint'), {
      code: PG_FOREIGN_KEY_VIOLATION,
    });
    const wrapped = new Error('Failed query: delete from "site"…', { cause: pgError });
    expect(pgErrorCode(wrapped)).toBe(PG_FOREIGN_KEY_VIOLATION);
  });

  it('đào được qua nhiều lớp bọc', () => {
    const deep = new Error('lớp 1', {
      cause: new Error('lớp 2', {
        cause: Object.assign(new Error('pg'), { code: '23503' }),
      }),
    });
    expect(pgErrorCode(deep)).toBe('23503');
  });

  it.each([
    ['lỗi thường không có mã', new Error('bùm')],
    ['null', null],
    ['undefined', undefined],
    ['code không phải chuỗi', { code: 23503 }],
  ])('%s → undefined', (_label, input) => {
    expect(pgErrorCode(input)).toBeUndefined();
  });

  it('không lặp vô hạn khi cause trỏ vòng lại chính nó', () => {
    const loop: { code?: string; cause?: unknown } = {};
    loop.cause = loop;
    expect(pgErrorCode(loop)).toBeUndefined();
  });
});

/**
 * `pgConstraint` là thứ phân biệt được HAI khóa duy nhất trên cùng một bảng.
 *
 * `users` có cả `users_email_uq` lẫn `users_employee_code_uq`. Chỉ nhìn mã `23505` rồi kết
 * luận "trùng mã nhân viên" là báo sai hẳn ô: người dùng để trống đúng ô mã nhân viên vẫn đọc
 * được câu `Mã nhân viên "" đã thuộc về một tài khoản khác`, còn lỗi thật thì bị nuốt mất.
 */
describe('pgConstraint — đào TÊN ràng buộc bị vi phạm', () => {
  it('đọc được tên ở ngay lớp ngoài (lỗi pg thô)', () => {
    expect(pgConstraint({ constraint: 'users_employee_code_uq' })).toBe('users_employee_code_uq');
  });

  it('đọc được tên khi drizzle bọc lỗi pg vào cause', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_email_uq',
    });
    const wrapped = new Error('Failed query: update "users"…', { cause: pgError });
    expect(pgConstraint(wrapped)).toBe('users_email_uq');
    // Hai hàm đọc CÙNG một lỗi ra hai mẩu tin khác nhau — nhánh dịch lỗi cần cả hai.
    expect(pgErrorCode(wrapped)).toBe('23505');
  });

  it('đào được qua nhiều lớp bọc', () => {
    const deep = new Error('lớp 1', {
      cause: new Error('lớp 2', {
        cause: Object.assign(new Error('pg'), { constraint: 'service_account_code_uq' }),
      }),
    });
    expect(pgConstraint(deep)).toBe('service_account_code_uq');
  });

  it.each([
    ['lỗi thường không có tên ràng buộc', new Error('bùm')],
    ['null', null],
    ['undefined', undefined],
    ['constraint không phải chuỗi', { constraint: 42 }],
    // 23505 KHÔNG kèm tên ràng buộc (vd lỗi do trigger dựng tay) phải ra undefined, để nhánh
    // dịch lỗi rơi về thông báo chung thay vì nhận nhầm là ô mình đang canh.
    ['lỗi có mã nhưng không có tên', { code: '23505' }],
  ])('%s → undefined', (_label, input) => {
    expect(pgConstraint(input)).toBeUndefined();
  });

  it('không lặp vô hạn khi cause trỏ vòng lại chính nó', () => {
    const loop: { constraint?: string; cause?: unknown } = {};
    loop.cause = loop;
    expect(pgConstraint(loop)).toBeUndefined();
  });
});

/**
 * `conflictOnUnique` — MỘT chỗ dịch 23505, mười hai nơi gọi.
 *
 * ===== VÌ SAO GOM, VÀ VÌ SAO BÀI NÀY QUAN TRỌNG HƠN VẺ NGOÀI =====
 *
 * Mười hai module đều viết lại đúng bốn dòng như nhau, chỉ khác `code` + `message`. Phần
 * GIỐNG NHAU lại chính là tri thức dễ sai nhất, và đã sai một lần thật: drizzle bọc lỗi pg
 * trong `DrizzleQueryError` và để lỗi gốc ở `cause`, nên đọc thẳng `error.code` luôn ra
 * `undefined` và MỌI câu dịch rơi xuống 500 (lỗi E2E story 2.1 — xóa site đang có tủ trả 500
 * thay vì 409 kèm gợi ý). Bản sao thứ mười ba viết tay là bản sao thứ mười ba có thể quên.
 */
describe('conflictOnUnique — dịch 23505 thành 409, mọi thứ khác đi qua nguyên vẹn', () => {
  const BODY = { code: 'DEVICE_CODE_TAKEN', message: 'Đã có thiết bị mang mã này.' };
  /** Đúng hình dạng drizzle ném ra: lỗi pg nằm ở `cause`, không ở lớp ngoài. */
  const wrapped = (code: string, constraint?: string) =>
    Object.assign(new Error('Failed query: ...'), {
      cause: Object.assign(new Error('pg'), { code, constraint }),
    });

  it('23505 (dù bị drizzle bọc) → ConflictException đúng nội dung', () => {
    const out = conflictOnUnique(wrapped('23505'), BODY);
    expect(out).toBeInstanceOf(ConflictException);
    expect((out as ConflictException).getResponse()).toEqual(BODY);
    expect((out as ConflictException).getStatus()).toBe(409);
  });

  it.each([
    ['khóa ngoại 23503 — "đang có thứ khác trỏ tới", câu trả lời khác hẳn', wrapped('23503')],
    ['CHECK 23514 — vd trigger IP ngoài dải', wrapped('23514')],
    ['lỗi thường, không phải lỗi DB', new Error('mất kết nối')],
    ['null', null],
  ])('%s → TRẢ NGUYÊN, không nuốt thành 409', (_label, input) => {
    const out = conflictOnUnique(input, BODY);
    expect(out).toBe(input);
    expect(out).not.toBeInstanceOf(ConflictException);
  });

  /**
   * Bảng có NHIỀU khóa duy nhất thì chỉ biết mã 23505 là chưa đủ: đoán bừa là báo nhầm hẳn ô
   * cho người dùng ("mã nhân viên trùng" trong khi thứ trùng là email).
   */
  it('lọc theo tên ràng buộc: đúng tên thì dịch, sai tên thì trả nguyên', () => {
    const err = wrapped('23505', 'users_employee_code_uq');
    expect(conflictOnUnique(err, BODY, 'users_employee_code_uq')).toBeInstanceOf(
      ConflictException,
    );
    expect(conflictOnUnique(err, BODY, 'users_email_uq')).toBe(err);
  });

  it('23505 KHÔNG kèm tên ràng buộc mà nơi gọi có yêu cầu tên → trả nguyên', () => {
    const err = wrapped('23505');
    expect(conflictOnUnique(err, BODY, 'users_employee_code_uq')).toBe(err);
  });
});

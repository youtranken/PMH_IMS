import { escapeLike, pgErrorCode, PG_FOREIGN_KEY_VIOLATION } from './sql';

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

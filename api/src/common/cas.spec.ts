import { ConflictException } from '@nestjs/common';
import { requireCas } from './cas';

/**
 * `requireCas` là chốt của mẫu compare-and-swap: câu UPDATE mang theo điều kiện đã kiểm,
 * rồi `.returning()` cho biết nó có trúng hàng nào không. Bài test này canh đúng ba nhánh,
 * vì nhánh giữa (0 hàng) là nhánh mà bỏ quên thì lỗi đua quay lại y như cũ mà không gì đỏ.
 */
describe('requireCas (AD-15 — chốt compare-and-swap)', () => {
  const conflict = { code: 'X_ALREADY_CHANGED', message: 'Người khác vừa đổi.' };

  it('trúng đúng một hàng → trả về chính hàng đó', () => {
    const row = { id: 'a', status: 'assigned' };
    expect(requireCas([row], conflict)).toBe(row);
  });

  it('KHÔNG trúng hàng nào → ném ConflictException đúng mã, không phải trả về undefined', () => {
    // Đây là toàn bộ lý do hàm này tồn tại. Bản cũ ở 5 service viết
    // `UPDATE ... WHERE id = ?` rồi dùng luôn kết quả — người bấm sau ghi đè người bấm
    // trước và cả hai đều thấy "thành công".
    expect(() => requireCas([], conflict)).toThrow(ConflictException);
    try {
      requireCas([], conflict);
      fail('phải ném');
    } catch (error) {
      expect((error as ConflictException).getResponse()).toEqual(conflict);
    }
  });

  it('trúng NHIỀU hàng → ném lỗi lập trình, không im lặng lấy hàng đầu', () => {
    // Trúng nhiều hàng nghĩa là câu WHERE thiếu điều kiện khóa chính. Lấy đại hàng đầu
    // sẽ che mất chuyện vừa ghi đè hàng loạt bản ghi của người khác.
    expect(() => requireCas([{ id: 'a' }, { id: 'b' }], conflict)).toThrow(/nhiều hơn một hàng/);
  });

  it('lỗi "nhiều hàng" KHÔNG phải ConflictException — nó là lỗi 500, không phải lỗi người dùng', () => {
    expect(() => requireCas([{ id: 'a' }, { id: 'b' }], conflict)).not.toThrow(ConflictException);
  });

  const cases: { ten: string; rows: unknown[]; nem: boolean }[] = [
    { ten: 'mảng rỗng', rows: [], nem: true },
    { ten: 'một hàng', rows: [{ id: 1 }], nem: false },
    { ten: 'hai hàng', rows: [{ id: 1 }, { id: 2 }], nem: true },
    { ten: 'ba hàng', rows: [{ id: 1 }, { id: 2 }, { id: 3 }], nem: true },
  ];
  it.each(cases)('bảng dữ liệu: $ten → ném = $nem', ({ rows, nem }) => {
    const run = () => requireCas(rows, conflict);
    if (nem) expect(run).toThrow();
    else expect(run()).toEqual(rows[0]);
  });
});

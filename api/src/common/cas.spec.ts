import { ConflictException } from '@nestjs/common';
import { requireCas, requireUnchangedSince } from './cas';

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

  const cases: { name: string; rows: unknown[]; throws: boolean }[] = [
    { name: 'mảng rỗng', rows: [], throws: true },
    { name: 'một hàng', rows: [{ id: 1 }], throws: false },
    { name: 'hai hàng', rows: [{ id: 1 }, { id: 2 }], throws: true },
    { name: 'ba hàng', rows: [{ id: 1 }, { id: 2 }, { id: 3 }], throws: true },
  ];
  it.each(cases)('bảng dữ liệu: $name → ném = $throws', ({ rows, throws }) => {
    const run = () => requireCas(rows, conflict);
    if (throws) expect(run).toThrow();
    else expect(run()).toEqual(rows[0]);
  });
});

describe('requireUnchangedSince (BE-02 — hàng đã khóa còn là hàng đã đọc)', () => {
  const conflict = { code: 'X_ALREADY_CHANGED', message: 'Hồ sơ vừa được người khác sửa.' };
  const at = (iso: string) => ({ updatedAt: new Date(iso) });

  const cases: { name: string; seen: string; locked: string; throws: boolean }[] = [
    { name: 'cùng thời điểm', seen: '2026-09-27T01:02:03.456Z', locked: '2026-09-27T01:02:03.456Z', throws: false },
    { name: 'lệch 1 ms', seen: '2026-09-27T01:02:03.456Z', locked: '2026-09-27T01:02:03.457Z', throws: true },
    { name: 'hàng khóa CŨ hơn ảnh chụp', seen: '2026-09-27T01:02:03.456Z', locked: '2026-09-26T01:02:03.456Z', throws: true },
  ];
  it.each(cases)('bảng dữ liệu: $name → ném = $throws', ({ seen, locked, throws }) => {
    const run = () => requireUnchangedSince(at(seen), at(locked), conflict);
    if (throws) expect(run).toThrow(ConflictException);
    else expect(run).not.toThrow();
  });

  it('so theo GIÁ TRỊ thời điểm, không theo danh tính object Date', () => {
    expect(() =>
      requireUnchangedSince(at('2026-09-27T00:00:00Z'), at('2026-09-27T00:00:00Z'), conflict),
    ).not.toThrow();
  });

  it('409 mang đúng mã và thông điệp được truyền vào', () => {
    let thrown: unknown = null;
    try {
      requireUnchangedSince(at('2026-09-27T00:00:00Z'), at('2026-09-27T00:00:01Z'), conflict);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toEqual(conflict);
  });
});

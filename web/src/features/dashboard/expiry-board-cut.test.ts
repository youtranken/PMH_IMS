import { describe, expect, it } from 'vitest';
import { cutExpiryBoard } from './expiry-board-cut';

const item = (daysLeft: number) => ({ daysLeft, id: String(daysLeft) });
const many = [-9, -8, -7, -6, -5, 0, 1, 2, 3].map(item);

describe('Bảng hết hạn trên điện thoại: cắt theo TỪNG nhóm', () => {
  it('điện thoại: 3 quá hạn + 3 sắp tới, nhóm Sắp tới không bị giấu sau nút', () => {
    const cut = cutExpiryBoard(many, { narrow: true, all: false, per: 3 });
    expect(cut.overdue.map((i) => i.daysLeft)).toEqual([-9, -8, -7]);
    expect(cut.upcoming.map((i) => i.daysLeft)).toEqual([0, 1, 2]);
    expect(cut.hidden).toBe(3);
  });

  it('máy tính hoặc đã bấm Xem thêm: đủ cả hai nhóm, không ẩn gì', () => {
    for (const opts of [{ narrow: false, all: false }, { narrow: true, all: true }]) {
      const cut = cutExpiryBoard(many, { ...opts, per: 3 });
      expect(cut.overdue).toHaveLength(5);
      expect(cut.upcoming).toHaveLength(4);
      expect(cut.hidden).toBe(0);
    }
  });

  it('ít mục: không cắt, không có nút', () => {
    expect(cutExpiryBoard([item(-1), item(2)], { narrow: true, all: false, per: 3 }).hidden).toBe(0);
  });
});

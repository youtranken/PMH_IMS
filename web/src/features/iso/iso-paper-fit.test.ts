import { describe, expect, it } from 'vitest';
import { paperZoom } from './iso-paper-fit';

describe('Bản giấy thu vừa khung', () => {
  it.each([
    // Khung rộng hơn trang: giữ nguyên cỡ, không phóng to.
    [1600, 1587, 1],
    // A3 ngang (0203) trong khung desktop ~1150px: thu nhỏ để thấy đủ ngày 30–31.
    [1150, 1587, 1150 / 1587],
    // A4 dọc (0206) trên điện thoại 342px: thu nhỏ thay vì bóp bảng đến chồng chữ.
    [342, 794, 342 / 794],
    // Chưa đo được (0) thì không đụng tới.
    [0, 794, 1],
    [342, 0, 1],
  ])('khung %ipx, trang %ipx → %f', (avail, natural, expected) => {
    expect(paperZoom(avail, natural)).toBeCloseTo(expected, 4);
  });
});

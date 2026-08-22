import { addDays, daysBetween, isoDateInTz } from './today';

describe('isoDateInTz — "hôm nay" theo múi giờ ứng dụng, không theo UTC', () => {
  /**
   * Đây là lỗi thật E2E story 3.4 bắt được: chạy lúc 6 giờ sáng giờ VN, UTC vẫn là hôm qua,
   * nên mọi phép "còn bao nhiêu ngày" lệch một ngày suốt 7 tiếng mỗi sáng.
   */
  it('6 giờ sáng giờ VN đã là NGÀY MỚI, dù UTC còn là hôm qua', () => {
    const at6amVn = new Date('2026-08-22T23:00:00Z'); // = 06:00 ngày 23/08 giờ VN
    expect(at6amVn.toISOString().slice(0, 10)).toBe('2026-08-22');
    expect(isoDateInTz('Asia/Ho_Chi_Minh', at6amVn)).toBe('2026-08-23');
  });

  it.each([
    ['2026-08-23T00:30:00Z', '2026-08-23'],
    ['2026-08-23T16:59:00Z', '2026-08-23'],
    ['2026-08-23T17:00:00Z', '2026-08-24'],
  ])('%s → %s (giờ VN)', (utc, expected) => {
    expect(isoDateInTz('Asia/Ho_Chi_Minh', new Date(utc))).toBe(expected);
  });

  it('múi giờ cấu hình sai thì lùi về UTC chứ không ném lỗi làm sập màn', () => {
    expect(isoDateInTz('Khong/Ton_Tai', new Date('2026-08-23T10:00:00Z'))).toBe('2026-08-23');
  });
});

describe('addDays / daysBetween', () => {
  it.each([
    ['2026-08-23', 0, '2026-08-23'],
    ['2026-08-23', 30, '2026-09-22'],
    ['2026-08-23', -365, '2025-08-23'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
  ])('addDays(%s, %s) → %s', (from, days, expected) => {
    expect(addDays(from, days)).toBe(expected);
  });

  it.each([
    ['2026-08-23', '2026-08-30', 7],
    ['2026-08-23', '2026-08-23', 0],
    ['2026-08-23', '2026-08-20', -3],
    ['2026-12-25', '2027-01-01', 7],
  ])('daysBetween(%s, %s) → %s', (from, end, expected) => {
    expect(daysBetween(from, end)).toBe(expected);
  });
});

import { addDays, dateTimeInTz, daysBetween, isoDateInTz, startOfDayInTz, viDate } from './today';

describe('isoDateInTz — "hôm nay" theo múi giờ ứng dụng, không theo UTC', () => {
  /**
   * Đây là lỗi thật E2E đã bắt: chạy lúc 6 giờ sáng giờ VN, UTC vẫn là hôm qua,
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

describe('startOfDayInTz — 00:00 của một ngày lịch theo múi giờ ứng dụng', () => {
  it.each([
    ['2026-09-29', 'Asia/Ho_Chi_Minh', '2026-09-28T17:00:00.000Z'],
    ['2026-09-29', 'UTC', '2026-09-29T00:00:00.000Z'],
    // Ngày đổi giờ mùa hè ở New York: 00:00 vẫn là -05:00 (đổi lúc 02:00).
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z'],
    ['2026-03-09', 'America/New_York', '2026-03-09T04:00:00.000Z'],
  ])('%s @ %s → %s', (iso, tz, expected) => {
    expect(startOfDayInTz(iso, tz).toISOString()).toBe(expected);
  });

  it('múi giờ cấu hình sai lùi về UTC chứ không ném', () => {
    expect(startOfDayInTz('2026-09-29', 'Khong/Co').toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });
});

describe('viDate — ngày trong câu người dùng đọc theo dd/mm/yyyy', () => {
  it.each([
    ['2026-08-30', '30/08/2026'],
    ['2027-01-02', '02/01/2027'],
  ])('%s → %s', (iso, shown) => {
    expect(viDate(iso)).toBe(shown);
  });

  it('không phải YYYY-MM-DD thì trả nguyên, không bịa ra ngày', () => {
    expect(viDate('không rõ')).toBe('không rõ');
    expect(viDate('')).toBe('');
  });
});

describe('dateTimeInTz — ô giờ của file Excel xuất: dd/mm/yyyy HH:mm theo múi ứng dụng', () => {
  it.each([
    ['2026-09-29T11:44:00Z', 'Asia/Ho_Chi_Minh', '29/09/2026 18:44'],
    // 00:05 giờ VN: không in "24:05", và ngày là ngày VN chứ không phải ngày UTC.
    ['2026-09-28T17:05:00Z', 'Asia/Ho_Chi_Minh', '29/09/2026 00:05'],
    ['2026-01-02T03:04:00Z', 'UTC', '02/01/2026 03:04'],
    ['2026-01-02T03:04:00Z', 'Khong/Co', '2026-01-02 03:04'],
  ])('%s @ %s → %s', (iso, tz, expected) => {
    expect(dateTimeInTz(new Date(iso), tz)).toBe(expected);
  });

  it('không có mốc → rỗng', () => {
    expect(dateTimeInTz(null, 'Asia/Ho_Chi_Minh')).toBe('');
  });
});

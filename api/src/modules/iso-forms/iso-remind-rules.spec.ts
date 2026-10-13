import { backupRecipientsDue, nthDayDue, submitReminderDue } from './iso-remind-rules';

describe('iso-remind-rules', () => {
  it.each([
    // [ngày cuối kỳ, hôm nay, nhắc lại mỗi N ngày, kết quả]
    ['2026-11-30', '2026-11-29', 3, false],
    ['2026-11-30', '2026-11-30', 3, true],
    ['2026-11-30', '2026-12-01', 3, false],
    ['2026-11-30', '2026-12-03', 3, true],
    ['2026-11-30', '2026-12-06', 3, true],
  ])('kỳ hết ngày %s · hôm nay %s · mỗi %i ngày → nhắc gửi chốt %s', (lastDay, today, every, out) => {
    expect(submitReminderDue(lastDay, today, every)).toBe(out);
  });

  it.each([
    // [mốc bắt đầu, hôm nay, sau N ngày, kết quả] — nhắc ở ngày N, 2N, 3N… sau mốc
    ['2026-11-01T02:00:00Z', '2026-11-07', 7, false],
    ['2026-11-01T02:00:00Z', '2026-11-08', 7, true],
    ['2026-11-01T02:00:00Z', '2026-11-09', 7, false],
    ['2026-11-01T02:00:00Z', '2026-11-15', 7, true],
  ])('mốc %s · hôm nay %s · N=%i → %s', (since, today, n, out) => {
    expect(nthDayDue(new Date(since), today, n, 'Asia/Ho_Chi_Minh')).toBe(out);
  });

  it('mốc theo giờ Việt Nam: 20h UTC ngày 31/10 là ngày 01/11 ở VN', () => {
    expect(nthDayDue(new Date('2026-10-31T20:00:00Z'), '2026-11-08', 7, 'Asia/Ho_Chi_Minh')).toBe(true);
  });

  it('ô còn trống quá N ngày thì thêm người dự phòng', () => {
    expect(backupRecipientsDue(['2026-11-09'], '2026-11-10', 2)).toBe(false);
    expect(backupRecipientsDue(['2026-11-08', '2026-11-09'], '2026-11-10', 2)).toBe(true);
    expect(backupRecipientsDue([], '2026-11-10', 2)).toBe(false);
  });
});

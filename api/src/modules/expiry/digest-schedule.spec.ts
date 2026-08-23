import {
  describeSchedule,
  localNowIn,
  shouldSendNow,
  type DigestSchedule,
  type LocalNow,
} from './digest-schedule';

/** Thứ Hai 23/08/2026, 8 giờ sáng giờ VN. */
const MONDAY_8AM: LocalNow = { date: '2026-08-24', hour: 8, weekday: 1, dayOfMonth: 24 };

function schedule(over: Partial<DigestSchedule> = {}): DigestSchedule {
  return { frequency: 'weekly', hour: 8, weekday: 1, ...over };
}

describe('shouldSendNow — đến kỳ gửi báo cáo chưa', () => {
  it('đúng ngày, đúng giờ, chưa gửi → GỬI', () => {
    expect(shouldSendNow(schedule(), MONDAY_8AM, null)).toBe(true);
  });

  it('đã gửi trong ngày rồi → thôi (sweep chạy mỗi phút, không được gửi 60 lần)', () => {
    expect(shouldSendNow(schedule(), MONDAY_8AM, '2026-08-24')).toBe(false);
  });

  it('chưa tới giờ hẹn → chưa gửi', () => {
    expect(shouldSendNow(schedule({ hour: 8 }), { ...MONDAY_8AM, hour: 7 }, null)).toBe(false);
  });

  /**
   * Điểm quan trọng nhất: sweep có thể lỡ nhịp vì Redis chết / container restart đúng 8 giờ.
   * Dùng "đúng giờ" thì lỡ một phút là mất cả kỳ; dùng "đã qua giờ" thì 9 giờ sống lại vẫn gửi bù.
   */
  it('lỡ nhịp lúc 8 giờ, 11 giờ mới chạy lại → VẪN GỬI BÙ', () => {
    expect(shouldSendNow(schedule({ hour: 8 }), { ...MONDAY_8AM, hour: 11 }, null)).toBe(true);
  });

  it('hằng tuần: không phải thứ đã hẹn thì không gửi', () => {
    const tuesday: LocalNow = { date: '2026-08-25', hour: 9, weekday: 2, dayOfMonth: 25 };
    expect(shouldSendNow(schedule({ weekday: 1 }), tuesday, null)).toBe(false);
    expect(shouldSendNow(schedule({ weekday: 2 }), tuesday, null)).toBe(true);
  });

  it('hằng ngày: ngày nào cũng gửi, miễn qua giờ và chưa gửi hôm nay', () => {
    const anyDay: LocalNow = { date: '2026-08-25', hour: 9, weekday: 2, dayOfMonth: 25 };
    expect(shouldSendNow(schedule({ frequency: 'daily' }), anyDay, null)).toBe(true);
    expect(shouldSendNow(schedule({ frequency: 'daily' }), anyDay, '2026-08-25')).toBe(false);
    expect(shouldSendNow(schedule({ frequency: 'daily' }), anyDay, '2026-08-24')).toBe(true);
  });

  it('hằng tháng: đúng ngày trong tháng mới gửi', () => {
    const first: LocalNow = { date: '2026-09-01', hour: 8, weekday: 2, dayOfMonth: 1 };
    expect(
      shouldSendNow(schedule({ frequency: 'monthly', dayOfMonth: 1 }), first, null),
    ).toBe(true);
    expect(
      shouldSendNow(schedule({ frequency: 'monthly', dayOfMonth: 15 }), first, null),
    ).toBe(false);
  });

  it('tuần trước đã gửi thì tuần này vẫn gửi (mốc so theo NGÀY, không phải "đã từng gửi")', () => {
    expect(shouldSendNow(schedule(), MONDAY_8AM, '2026-08-17')).toBe(true);
  });
});

describe('describeSchedule', () => {
  it.each([
    [schedule({ frequency: 'daily', hour: 7 }), 'Hằng ngày lúc 07:00'],
    [schedule({ frequency: 'weekly', weekday: 1, hour: 8 }), 'Hằng tuần, Thứ Hai lúc 08:00'],
    [schedule({ frequency: 'weekly', weekday: 7, hour: 20 }), 'Hằng tuần, Chủ Nhật lúc 20:00'],
    [
      schedule({ frequency: 'monthly', dayOfMonth: 5, hour: 9 }),
      'Hằng tháng, ngày 5 lúc 09:00',
    ],
  ])('%o → %s', (value, expected) => {
    expect(describeSchedule(value)).toBe(expected);
  });
});

describe('localNowIn — quy mốc thời gian về múi giờ ứng dụng', () => {
  it('6 giờ sáng giờ VN là NGÀY MỚI dù UTC còn hôm qua', () => {
    const at6amVn = new Date('2026-08-23T23:00:00Z');
    expect(localNowIn('Asia/Ho_Chi_Minh', at6amVn)).toEqual({
      date: '2026-08-24',
      hour: 6,
      weekday: 1,
      dayOfMonth: 24,
    });
  });

  it('nửa đêm giờ VN cho giờ 0, không phải 24', () => {
    const midnightVn = new Date('2026-08-23T17:00:00Z');
    expect(localNowIn('Asia/Ho_Chi_Minh', midnightVn).hour).toBe(0);
  });

  it.each([
    ['2026-08-24T03:00:00Z', 1],
    ['2026-08-29T03:00:00Z', 6],
    ['2026-08-30T03:00:00Z', 7],
  ])('%s → thứ %s (1=Thứ Hai, 7=Chủ Nhật)', (utc, expected) => {
    expect(localNowIn('Asia/Ho_Chi_Minh', new Date(utc)).weekday).toBe(expected);
  });
});

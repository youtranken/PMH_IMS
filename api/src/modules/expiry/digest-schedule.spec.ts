import { lookBackDays } from './expiry.service';
import {
  describeSchedule,
  localNowIn,
  nextSendAt,
  nextSendSlot,
  shouldSendNow,
  startOfLocalDayUtc,
  weekdayOf,
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

  /**
   * Múi giờ hỏng phải lùi về UTC, KHÔNG ném: `isoDateInTz` đã theo nếp đó. Hàm này mà ném
   * thì màn Expiry vẫn chạy còn digest im lặng không bao giờ gửi (code review Epic 3).
   */
  it('múi giờ cấu hình sai thì lùi về UTC chứ không ném', () => {
    const at = new Date('2026-08-24T10:00:00Z');
    expect(localNowIn('Khong/Ton_Tai', at)).toEqual({
      date: '2026-08-24',
      hour: 10,
      weekday: 1,
      dayOfMonth: 24,
    });
  });
});

describe('weekdayOf — suy thứ TỪ NGÀY, không đọc tên viết tắt của Intl', () => {
  it.each([
    ['2026-08-24', 1],
    ['2026-08-25', 2],
    ['2026-08-29', 6],
    ['2026-08-30', 7],
    ['2027-01-01', 5],
  ])('%s → thứ %s', (date, expected) => {
    expect(weekdayOf(date)).toBe(expected);
  });
});

/**
 * MỐC ĐẦU NGÀY THEO MÚI GIỜ ỨNG DỤNG, KHÔNG PHẢI NỬA ĐÊM UTC.
 *
 * ===== BẪY =====
 *
 * `runOne()` dựng trọng tài chống-gửi-trùng bằng
 *
 *     const startOfDayUtc = new Date(`${local.date}T00:00:00Z`);   // ← SAI
 *     ... where last_sent_at IS NULL OR last_sent_at < startOfDayUtc
 *
 * `local.date` là ngày theo GIỜ VIỆT NAM, nhưng `T00:00:00Z` dán vào nó lại là nửa đêm UTC —
 * tức là 7 giờ SÁNG cùng ngày ở Việt Nam. Nên với mọi luật hẹn giờ 0..6:
 *
 *     Luật "hằng ngày 6 giờ sáng". Gửi lúc 06:00 giờ VN ngày 10/09
 *       = 23:00Z ngày 09/09  →  ghi last_sent_at = 2026-09-09T23:00:00Z
 *     Câu UPDATE giành kỳ hỏi: 2026-09-09T23:00Z < 2026-09-10T00:00Z ?  → ĐÚNG.
 *
 * Nghĩa là trọng tài "nhiều nhất một lần" — thứ duy nhất chặn HAI worker cùng gửi một kỳ —
 * KHÔNG chặn gì cả với các luật hẹn giờ sớm. Hàng rào thứ hai (`shouldSendNow` so theo ngày
 * địa phương) vẫn đứng, nhưng nó chạy TRONG BỘ NHỚ trên ảnh chụp đọc trước đó: hai worker
 * cùng đọc `last_sent_at` cũ thì cả hai cùng qua. Trọng tài ở DB tồn tại đúng để bắt trường
 * hợp đó, và với luật 0..6 giờ nó im lặng gật đầu.
 *
 * Hậu quả: luật gửi lúc 6 giờ sáng gửi ĐÔI mỗi kỳ khi có hai worker — và giờ sớm lại đúng là
 * giờ người ta chọn cho báo cáo đầu ngày.
 */
describe('startOfLocalDayUtc — đầu ngày ĐỊA PHƯƠNG, tính bằng UTC', () => {
  it.each([
    ['Việt Nam (+07, không có giờ mùa hè)', 'Asia/Ho_Chi_Minh', '2026-09-10', '2026-09-09T17:00:00.000Z'],
    ['UTC', 'UTC', '2026-09-10', '2026-09-10T00:00:00.000Z'],
    ['Tokyo (+09)', 'Asia/Tokyo', '2026-09-10', '2026-09-09T15:00:00.000Z'],
    ['New York mùa hè (-04)', 'America/New_York', '2026-09-10', '2026-09-10T04:00:00.000Z'],
    ['New York mùa đông (-05)', 'America/New_York', '2026-01-10', '2026-01-10T05:00:00.000Z'],
  ])('%s', (_name, timeZone, isoDate, expected) => {
    expect(startOfLocalDayUtc(timeZone, isoDate).toISOString()).toBe(expected);
  });

  /** Múi giờ gõ sai lùi về UTC chứ không ném — cùng nếp với `localNowIn`/`isoDateInTz`. */
  it('múi giờ không hợp lệ → lùi về UTC, không ném', () => {
    expect(startOfLocalDayUtc('Hành/Tinh_Sao_Hoả', '2026-09-10').toISOString()).toBe(
      '2026-09-10T00:00:00.000Z',
    );
  });

  /**
   * ĐÂY LÀ BÀI CHỐT, viết lại đúng tình huống của `runOne`: một luật gửi lúc 6 giờ sáng giờ
   * VN. Mốc trả về PHẢI đứng trước thời điểm gửi, nếu không trọng tài giành kỳ vô hiệu.
   */
  it('luật gửi 6 giờ sáng giờ VN: mốc đầu ngày phải TRƯỚC thời điểm gửi', () => {
    const sentAt = new Date('2026-09-09T23:00:00Z'); // = 06:00 ngày 10/09 giờ VN
    const start = startOfLocalDayUtc('Asia/Ho_Chi_Minh', '2026-09-10');

    expect(start.getTime()).toBeLessThan(sentAt.getTime());
    // Và sau khi đã gửi, `last_sent_at < start` phải SAI — kỳ này coi như đã chốt.
    expect(sentAt.getTime() < start.getTime()).toBe(false);
  });
});

/**
 * MÀN HÌNH VÀ EMAIL PHẢI NHÌN LÙI KHÁC NHAU.
 *
 * Màn hình là thứ người ta KÉO tới xem: nhìn lùi một năm là đúng, vì mục quá hạn 200 ngày mà
 * chưa ai xử chính là thứ nguy hiểm nhất.
 *
 * Email là thứ ĐẨY tới, hằng tuần, mãi mãi. Cùng một mục đó nằm trong 52 lá thư liên tiếp —
 * một tên miền công ty đã bỏ, xuất hiện đều đặn cả năm. Không ai xử được nó bằng email (việc
 * phải làm ở màn khác), nên nó chỉ dạy người nhận rằng thư này có thứ không cần đọc.
 */
describe('lookBackDays — nhìn lùi bao xa để bắt mục đã quá hạn', () => {
  it.each([
    ['mặc định (màn hình): một năm', {}, 365],
    ['digest đọc từ system_config', { expiredWithinDays: 30 }, 30],
    ['bộ lọc "chỉ sắp tới": không nhìn lùi tí nào', { includeExpired: false }, 0],
    [
      '`includeExpired: false` THẮNG cả con số — người dùng đã nói rõ là không muốn',
      { includeExpired: false, expiredWithinDays: 30 },
      0,
    ],
    ['0 là một câu trả lời hợp lệ, không phải "chưa cấu hình"', { expiredWithinDays: 0 }, 0],
    ['kẹp trần ở một năm', { expiredWithinDays: 99_999 }, 365],
    [
      'số ÂM kẹp về 0 — nếu không nó đẩy mốc ra TƯƠNG LAI và giấu sạch mục quá hạn',
      { expiredWithinDays: -30 },
      0,
    ],
    ['số lẻ cắt phần thập phân', { expiredWithinDays: 30.9 }, 30],
    ['NaN rơi về mặc định', { expiredWithinDays: Number.NaN }, 365],
  ])('%s', (_name, query, expected) => {
    expect(lookBackDays(query)).toBe(expected);
  });
});

describe('nextSendSlot — lần gửi tới (EX-021), khớp đúng luật của shouldSendNow', () => {
  const at = (date: string, hour: number): LocalNow => ({
    date,
    hour,
    weekday: weekdayOf(date),
    dayOfMonth: Number(date.slice(8, 10)),
  });

  it.each<[string, DigestSchedule, LocalNow, string | null, { date: string; hour: number }]>([
    ['hằng ngày, chưa tới giờ → hôm nay', { frequency: 'daily', hour: 8 }, at('2026-08-24', 7), null, { date: '2026-08-24', hour: 8 }],
    ['hằng ngày, đã gửi hôm nay → mai', { frequency: 'daily', hour: 8 }, at('2026-08-24', 9), '2026-08-24', { date: '2026-08-25', hour: 8 }],
    // Qua giờ mà kỳ hôm nay chưa gửi (sweep lỡ nhịp) → vẫn là hôm nay: shouldSendNow sẽ gửi bù.
    ['hằng ngày, quá giờ chưa gửi → hôm nay', { frequency: 'daily', hour: 8 }, at('2026-08-24', 10), null, { date: '2026-08-24', hour: 8 }],
    ['hằng tuần thứ Hai, hôm nay thứ Tư → thứ Hai tới', { frequency: 'weekly', hour: 8, weekday: 1 }, at('2026-08-26', 9), null, { date: '2026-08-31', hour: 8 }],
    ['hằng tuần thứ Hai, đã gửi sáng nay → tuần sau', { frequency: 'weekly', hour: 8, weekday: 1 }, at('2026-08-24', 9), '2026-08-24', { date: '2026-08-31', hour: 8 }],
    ['hằng tháng ngày 1, hôm nay 24/08 → 01/09', { frequency: 'monthly', hour: 9, dayOfMonth: 1 }, at('2026-08-24', 9), null, { date: '2026-09-01', hour: 9 }],
    ['hằng tháng ngày 28, cuối tháng 2 → 28/02', { frequency: 'monthly', hour: 9, dayOfMonth: 28 }, at('2027-02-10', 9), null, { date: '2027-02-28', hour: 9 }],
  ])('%s', (_name, rule, now, lastSent, expected) => {
    expect(nextSendSlot(rule, now, lastSent)).toEqual(expected);
  });

  it('đổi ra mốc UTC theo múi giờ ứng dụng: 08:00 giờ VN = 01:00Z', () => {
    expect(
      nextSendAt({ frequency: 'daily', hour: 8 }, 'Asia/Ho_Chi_Minh', null, new Date('2026-08-24T00:00:00Z')),
    ).toEqual(new Date('2026-08-24T01:00:00Z'));
  });
});

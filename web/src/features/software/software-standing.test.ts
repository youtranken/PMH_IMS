import { describe, expect, it } from 'vitest';
import {
  formerDevices,
  isoDay,
  plusOneYear,
  restoreEndReason,
  retiredAfterDays,
  seatFlag,
  standingOf,
} from './software-standing';

const NOW = new Date(2026, 9, 1); // 01/10/2026, giờ địa phương

describe('standingOf — cột "Tình trạng" gộp trạng thái Q-03 và số ngày', () => {
  it.each([
    [
      'Đang dùng có hạn → chỉ badge đếm ngày',
      { status: 'active', licenseModel: 'subscription', endDate: '2026-10-13', autoRetireOn: null },
      { kind: 'countdown', overdueDays: null, retireInDays: null },
    ],
    [
      'Đang dùng vĩnh viễn',
      { status: 'active', licenseModel: 'perpetual', endDate: null, autoRetireOn: null },
      { kind: 'perpetual', overdueDays: null, retireInDays: null },
    ],
    [
      'Đang dùng không có hạn (bảo trì)',
      { status: 'active', licenseModel: 'subscription', endDate: null, autoRetireOn: null },
      { kind: 'noEnd', overdueDays: null, retireInDays: null },
    ],
    [
      'Hết hạn 10 ngày, tự thanh lý ngày 22/10',
      { status: 'expired_ok', licenseModel: 'subscription', endDate: '2026-09-21', autoRetireOn: '2026-10-22' },
      { kind: 'expired', overdueDays: 10, retireInDays: 21 },
    ],
    [
      'Hết hạn, tự thanh lý đang tắt',
      { status: 'expired_ok', licenseModel: 'subscription', endDate: '2026-09-21', autoRetireOn: null },
      { kind: 'expired', overdueDays: 10, retireInDays: null },
    ],
    [
      'Hết hạn, lượt quét đã tới hạn mà chưa chạy → 0, không âm',
      { status: 'expired_ok', licenseModel: 'subscription', endDate: '2026-08-01', autoRetireOn: '2026-09-01' },
      { kind: 'expired', overdueDays: 61, retireInDays: 0 },
    ],
    [
      'Đã thanh lý',
      { status: 'retired', licenseModel: 'subscription', endDate: '2026-08-01', autoRetireOn: null },
      { kind: 'retired', overdueDays: null, retireInDays: null },
    ],
  ] as const)('%s', (_name, row, expected) => {
    expect(standingOf(row, NOW)).toEqual(expected);
  });
});

describe('seatFlag — hết ghế / vượt ghế', () => {
  it.each([
    [2, 3, null],
    [3, 3, { over: 0 }],
    [4, 3, { over: 1 }],
    [0, 0, { over: 0 }],
    [5, null, null],
  ] as const)('%i/%s', (used, total, expected) => {
    expect(seatFlag(used, total)).toEqual(expected);
  });
});

describe('retiredAfterDays — "tự động sau N ngày hết hạn"', () => {
  it('đếm theo ngày lịch từ hạn tới ngày thanh lý', () => {
    expect(retiredAfterDays('2026-08-31', new Date(2026, 9, 1, 2, 5))).toBe(31);
  });
  it('không có hạn thì không nói được', () => {
    expect(retiredAfterDays(null, NOW)).toBeNull();
  });
});

describe('hộp Khôi phục — hạn mới và các máy từng dùng', () => {
  it('isoDay: ngày lịch địa phương, không lệch múi giờ', () => {
    expect(isoDay(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });

  it('plusOneYear: 29/02 lùi về 28/02 thay vì tràn sang tháng 3', () => {
    expect(plusOneYear('2026-10-01')).toBe('2027-10-01');
    expect(plusOneYear('2028-02-29')).toBe('2029-02-28');
  });

  it.each([
    ['', true, 'required'],
    ['', false, null],
    ['2026-09-30', true, 'past'],
    ['2026-09-30', false, 'past'],
    ['2026-10-01', true, null],
    ['2027-10-01', true, null],
  ] as const)('restoreEndReason(%s, cần hạn=%s) → %s', (end, needed, reason) => {
    expect(restoreEndReason(end, '2026-10-01', needed)).toBe(reason);
  });

  it('formerDevices: máy đã gỡ, mỗi máy một lần, mới gỡ trước; bỏ máy đang giữ ghế', () => {
    const rows = [
      { deviceId: 'a', deviceCode: 'PC-A', deviceName: 'A', releasedAt: '2026-09-01T00:00:00Z' },
      { deviceId: 'b', deviceCode: 'PC-B', deviceName: 'B', releasedAt: '2026-09-20T00:00:00Z' },
      { deviceId: 'a', deviceCode: 'PC-A', deviceName: 'A', releasedAt: '2026-09-25T00:00:00Z' },
      { deviceId: 'c', deviceCode: 'PC-C', deviceName: 'C', releasedAt: null },
      { deviceId: 'c', deviceCode: 'PC-C', deviceName: 'C', releasedAt: '2026-08-01T00:00:00Z' },
    ];
    expect(formerDevices(rows).map((d) => d.deviceCode)).toEqual(['PC-A', 'PC-B']);
  });
});

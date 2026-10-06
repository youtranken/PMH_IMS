import { describe, expect, it } from 'vitest';
import { dayAt, daySpan, officialOn } from './diagram-timeline';

const EVENTS = [
  // 01/09 08:00 giờ VN
  { versionId: 'v1', seq: 1, at: '2026-09-01T01:00:00Z' },
  // 10/09 06:30 giờ VN — vẫn là 09/09 theo UTC: ngày tính theo giờ Việt Nam
  { versionId: 'v3', seq: 3, at: '2026-09-09T23:30:00Z' },
  // khôi phục bản cũ làm chính thức: phiên bản mới chép #1
  { versionId: 'v5', seq: 5, at: '2026-09-20T03:00:00Z' },
];

describe('officialOn — bản chính thức hiệu lực một ngày (sự kiện phát hành, Q-23)', () => {
  it.each([
    ['trước lần phát hành đầu: chưa có', '2026-08-31', null],
    ['đúng ngày phát hành đầu', '2026-09-01', 'v1'],
    ['giữa hai lần phát hành', '2026-09-05', 'v1'],
    ['ngày VN của lần phát hành thứ hai (UTC còn hôm trước)', '2026-09-10', 'v3'],
    ['ngày UTC của lần đó nhưng giờ VN chưa tới', '2026-09-09', 'v1'],
    ['sau lần cuối', '2026-10-03', 'v5'],
  ])('%s', (_name, day, expected) => {
    expect(officialOn(EVENTS, day)?.versionId ?? null).toBe(expected);
  });

  it('không có sự kiện nào: chưa có bản chính thức', () => {
    expect(officialOn([], '2026-10-03')).toBeNull();
  });

  it('thứ tự đầu vào không quan trọng', () => {
    expect(officialOn([...EVENTS].reverse(), '2026-09-05')?.versionId).toBe('v1');
  });
});

describe('thang ngày của thanh trượt', () => {
  it('từ ngày phát hành đầu (lùi một ngày để kéo được về "chưa có") tới hôm nay', () => {
    expect(daySpan(EVENTS, '2026-10-03')).toEqual({ from: '2026-08-31', days: 33 });
  });

  it('chưa phát hành lần nào: chỉ hôm nay', () => {
    expect(daySpan([], '2026-10-03')).toEqual({ from: '2026-10-03', days: 0 });
  });

  it('dayAt cộng ngày theo lịch, qua tháng', () => {
    expect(dayAt('2026-08-31', 0)).toBe('2026-08-31');
    expect(dayAt('2026-08-31', 1)).toBe('2026-09-01');
    expect(dayAt('2026-08-31', 33)).toBe('2026-10-03');
  });
});

import { describe, expect, it } from 'vitest';
import { heldSummary, warrantyNudgeEnd } from './device-glance';

const NOW = new Date('2026-09-29T08:00:00+07:00');

describe('warrantyNudgeEnd — máy Hỏng còn bảo hành thì nhắc gọi NCC', () => {
  it.each([
    ['broken', '2026-12-31', '2026-12-31'],
    ['broken', '2026-09-29', '2026-09-29'], // hết hạn hôm nay vẫn còn gọi được
    ['broken', '2026-09-28', null], // đã quá hạn: nhắc gọi bảo hành là sai
    ['broken', null, null],
    ['in_use', '2026-12-31', null], // máy chạy tốt không cần nhắc
    ['spare', '2026-12-31', null],
    ['retired', '2026-12-31', null],
  ] as const)('%s · %s → %s', (status, end, expected) => {
    expect(warrantyNudgeEnd(status, end, NOW)).toBe(expected);
  });
});

describe('heldSummary — hàng "Đang giữ"', () => {
  it('chỉ giữ mục có số > 0, đúng thứ tự khai', () => {
    expect(
      heldSummary([
        { key: 'ipam', count: 1 },
        { key: 'ports', count: 0 },
        { key: 'vault', count: 2 },
      ]),
    ).toEqual([
      { key: 'ipam', count: 1 },
      { key: 'vault', count: 2 },
    ]);
  });

  it('số CHƯA BIẾT (undefined) không bị nói thành 0 hay bị đếm', () => {
    expect(heldSummary([{ key: 'files', count: undefined }])).toEqual([]);
  });
});

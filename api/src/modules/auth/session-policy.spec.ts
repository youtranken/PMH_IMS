import { evaluateSession, isStepUpValid, stepUpSecondsLeft } from './session-policy';

const NOW = new Date('2026-08-22T10:00:00Z');
const alive = {
  lastSeenAt: new Date('2026-08-22T09:50:00Z'),
  absoluteExpiresAt: new Date('2026-08-22T20:00:00Z'),
  revokedAt: null,
};

describe('evaluateSession — NFR-01 idle 30 phút / absolute 12 giờ', () => {
  it('vừa hoạt động 10 phút trước → còn sống', () => {
    expect(evaluateSession(alive, 30, NOW)).toBe('alive');
  });

  it('đúng 30 phút không hoạt động → chết vì idle', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:30:00Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('idle-expired');
  });

  it('29 phút 59 giây vẫn sống', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:30:01Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('alive');
  });

  it('quá trần tuyệt đối thì chết dù vừa mới hoạt động', () => {
    const s = {
      lastSeenAt: NOW,
      absoluteExpiresAt: new Date('2026-08-22T09:59:59Z'),
      revokedAt: null,
    };
    expect(evaluateSession(s, 30, NOW)).toBe('absolute-expired');
  });

  it('SA đá phiên thì chết ngay, ưu tiên hơn mọi lý do khác', () => {
    const s = { ...alive, revokedAt: new Date('2026-08-22T09:59:00Z') };
    expect(evaluateSession(s, 30, NOW)).toBe('revoked');
  });

  it('đổi idle qua system_config có hiệu lực ngay', () => {
    const s = { ...alive, lastSeenAt: new Date('2026-08-22T09:55:00Z') };
    expect(evaluateSession(s, 5, NOW)).toBe('idle-expired');
    expect(evaluateSession(s, 10, NOW)).toBe('alive');
  });
});

describe('isStepUpValid — FR-022 grace 10 phút', () => {
  it('chưa gõ TOTP lần nào → không hợp lệ', () => {
    expect(isStepUpValid(null, 10, NOW)).toBe(false);
  });

  it('gõ 9 phút trước → còn hiệu lực', () => {
    expect(isStepUpValid(new Date('2026-08-22T09:51:00Z'), 10, NOW)).toBe(true);
  });

  it('gõ đúng 10 phút trước → hết hiệu lực, phải gõ lại', () => {
    expect(isStepUpValid(new Date('2026-08-22T09:50:00Z'), 10, NOW)).toBe(false);
  });
});

/**
 * Con số bên PHẢI của đồng hồ đếm ngược trong hộp hiện secret ("60s / 600s").
 *
 * Client không tự tính được: nó không biết `stepped_up_at`. Tự đếm từ lần gõ mã gần nhất thì
 * mỗi tab của cùng một phiên ra một con số khác nhau — và con số đó là thứ người dùng dựa vào
 * để quyết định "mở nốt cái nữa hay gõ lại mã cho chắc".
 */
describe('stepUpSecondsLeft — còn bao lâu nữa phải gõ lại mã', () => {
  const cases: { name: string; at: string | null; grace: number; expected: number }[] = [
    { name: 'chưa gõ lần nào', at: null, grace: 10, expected: 0 },
    { name: 'vừa gõ xong', at: '2026-08-22T10:00:00Z', grace: 10, expected: 600 },
    { name: 'gõ 1 phút trước', at: '2026-08-22T09:59:00Z', grace: 10, expected: 540 },
    // Mở secret thứ hai sau 10 giây: đúng cái "60s/590s" mà người dùng thấy.
    { name: 'gõ 10 giây trước', at: '2026-08-22T09:59:50Z', grace: 10, expected: 590 },
    { name: 'gõ 9 phút 59 giây trước', at: '2026-08-22T09:50:01Z', grace: 10, expected: 1 },
    // Hết hạn thì 0, KHÔNG phải số âm — số âm rơi thẳng vào giao diện thành "-37s".
    { name: 'đúng lúc hết hạn', at: '2026-08-22T09:50:00Z', grace: 10, expected: 0 },
    { name: 'đã quá hạn từ lâu', at: '2026-08-22T08:00:00Z', grace: 10, expected: 0 },
    // AD-11: đổi grace trong system_config là đổi ngay, không phải sửa code.
    { name: 'grace 2 phút', at: '2026-08-22T09:59:00Z', grace: 2, expected: 60 },
  ];

  for (const { name, at, grace, expected } of cases) {
    it(`${name} (grace ${grace}p) → ${expected}s`, () => {
      expect(stepUpSecondsLeft(at === null ? null : new Date(at), grace, NOW)).toBe(expected);
    });
  }
});

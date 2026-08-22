import { evaluateSession, isStepUpValid } from './session-policy';

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

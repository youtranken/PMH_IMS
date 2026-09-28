import { describe, expect, it } from 'vitest';
import {
  CHANGE_PASSWORD_PATH,
  HOME_PATH,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  nextStepPath,
  pendingSetupSteps,
  setupProgress,
  type Me,
} from './me';

const base: Me = {
  id: 'u1',
  email: 'it01@pmh.com.vn',
  fullName: 'IT Nhân viên 01',
  role: 'member',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30 },
};

describe('nextStepPath — luồng đăng nhập chỉ có MỘT nơi quyết định', () => {
  it('chưa đăng nhập → màn đăng nhập', () => {
    expect(nextStepPath(null)).toBe(LOGIN_PATH);
  });

  it('đúng mật khẩu, CHƯA cài 2 lớp → màn cài đặt (không phải màn nhập mã)', () => {
    expect(nextStepPath({ ...base, totpPending: true, totpEnrolled: false })).toBe(
      TOTP_ENROLL_PATH,
    );
  });

  it('đúng mật khẩu, ĐÃ cài 2 lớp → màn nhập mã', () => {
    expect(nextStepPath({ ...base, totpPending: true, totpEnrolled: true })).toBe(
      TOTP_CHALLENGE_PATH,
    );
  });

  it('qua 2 lớp nhưng còn nợ đổi mật khẩu → màn đổi mật khẩu', () => {
    expect(nextStepPath({ ...base, mustChangePassword: true })).toBe(CHANGE_PASSWORD_PATH);
  });

  it('2 lớp chặn TRƯỚC đổi mật khẩu (thứ tự ưu tiên)', () => {
    expect(
      nextStepPath({ ...base, totpPending: true, totpEnrolled: true, mustChangePassword: true }),
    ).toBe(TOTP_CHALLENGE_PATH);
  });

  it('đủ điều kiện → vào app', () => {
    expect(nextStepPath(base)).toBe(HOME_PATH);
  });
});

describe('pendingSetupSteps / setupProgress — "Bước 1/2" của luồng đăng nhập lần đầu', () => {
  it.each([
    ['người mới: cài 2 lớp rồi đổi mật khẩu tạm', { totpPending: true, totpEnrolled: false, mustChangePassword: true }, ['totpEnroll', 'changePassword']],
    ['chỉ nợ đổi mật khẩu', { mustChangePassword: true }, ['changePassword']],
    ['nhập mã 2 lớp thường ngày không phải bước cài đặt', { totpPending: true, totpEnrolled: true }, []],
    ['đủ điều kiện', {}, []],
  ] as const)('%s', (_label, patch, steps) => {
    expect(pendingSetupSteps({ ...base, ...patch })).toEqual(steps);
  });

  it('chưa đăng nhập thì không có bước nào', () => {
    expect(pendingSetupSteps(null)).toEqual([]);
  });

  it.each([
    // [còn lại, tổng đã thấy, bước hiện tại, tổng]
    [2, 0, 1, 2],
    [1, 2, 2, 2],
    [1, 0, 1, 1],
    [2, 1, 1, 2],
  ])('còn %i bước, đã thấy tổng %i → bước %i/%i', (remaining, seen, current, total) => {
    expect(setupProgress(remaining, seen)).toEqual({ current, total });
  });
});

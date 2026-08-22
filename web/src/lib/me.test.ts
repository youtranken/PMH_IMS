import { describe, expect, it } from 'vitest';
import {
  CHANGE_PASSWORD_PATH,
  HOME_PATH,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  nextStepPath,
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

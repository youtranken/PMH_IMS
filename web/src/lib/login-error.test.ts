import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { classifyLoginError, formatWait } from './login-error';

describe('formatWait', () => {
  it.each([
    [272, '4:32'],
    [60, '1:00'],
    [59.2, '1:00'],
    [5, '0:05'],
    [0, '0:00'],
    [-3, '0:00'],
  ])('%s giây → %s', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});

/**
 * Một lượt đăng nhập hỏng thì màn phải làm KHÁC nhau theo nguyên nhân: sai mật khẩu thì xoá ô và
 * đưa con trỏ về; bị tạm khoá thì đếm ngược và khoá nút; bị quản trị khoá thì chỉ người mở;
 * mất mạng thì GIỮ nguyên mật khẩu vì người dùng không gõ sai gì cả.
 */
describe('classifyLoginError', () => {
  const cases: [string, unknown, string, number | null][] = [
    ['sai email/mật khẩu', new ApiError(401, { code: 'LOGIN_FAILED', message: 'x' }), 'wrong', null],
    [
      'tạm khoá tự động có giờ mở',
      new ApiError(401, { code: 'ACCOUNT_LOCKED', message: 'x', retryAfterSeconds: 272 }),
      'wait',
      272,
    ],
    [
      'quản trị khoá tay — không có giờ mở',
      new ApiError(401, { code: 'ACCOUNT_LOCKED', message: 'x' }),
      'locked',
      null,
    ],
    ['đã vô hiệu hoá', new ApiError(401, { code: 'ACCOUNT_DISABLED', message: 'x' }), 'disabled', null],
    [
      'mật khẩu tạm quá hạn (Q-20)',
      new ApiError(401, { code: 'TEMP_PASSWORD_EXPIRED', message: 'x' }),
      'tempExpired',
      null,
    ],
    ['quá hạn mức theo IP', new ApiError(429, { message: 'x' }), 'other', null],
    ['máy chủ lỗi', new ApiError(502, null), 'other', null],
    ['mất mạng', new TypeError('Failed to fetch'), 'other', null],
    [
      'giờ mở âm hoặc hỏng thì không đếm ngược',
      new ApiError(401, { code: 'ACCOUNT_LOCKED', retryAfterSeconds: -5 }),
      'locked',
      null,
    ],
  ];

  it.each(cases)('%s', (_label, error, kind, seconds) => {
    const result = classifyLoginError(error);
    expect(result.kind).toBe(kind);
    expect(result.retryAfterSeconds).toBe(seconds);
  });

  it('chỉ lượt SAI MẬT KHẨU mới xoá ô mật khẩu', () => {
    expect(classifyLoginError(new ApiError(401, { code: 'LOGIN_FAILED' })).clearPassword).toBe(true);
    expect(classifyLoginError(new TypeError('x')).clearPassword).toBe(false);
    expect(classifyLoginError(new ApiError(500, null)).clearPassword).toBe(false);
  });
});

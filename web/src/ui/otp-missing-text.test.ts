import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { otpMissingText } from './otp-input';

/** Bấm gửi khi ô mã chưa đủ: trống thì nhắc nhập (Q-20), thiếu vài số thì nói thiếu mấy. */
describe('otpMissingText', () => {
  const t = i18n.t.bind(i18n) as (key: string, opts?: Record<string, unknown>) => string;
  it.each([
    [null, null],
    [0, null],
    [6, 'Vui lòng nhập mã xác thực.'],
    [5, 'Còn thiếu 5 số.'],
    [1, 'Còn thiếu 1 số.'],
  ])('thiếu %s → %s', (missing, expected) => {
    expect(otpMissingText(t, missing)).toBe(expected);
  });
});

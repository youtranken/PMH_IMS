import { describe, expect, it } from 'vitest';
import { isEmail } from '@/lib/email';

// Chỉ bắt lỗi gõ nhầm hiển nhiên — API mới là nơi quyết email hợp lệ.
describe('isEmail', () => {
  it.each(['a@pmh.com.vn', 'it.support@pmh.vn', ' ketoan@pmh.com.vn '])('%j → hợp lệ', (value) => {
    expect(isEmail(value)).toBe(true);
  });

  it.each(['', 'pmh.com.vn', 'a@pmh', 'a b@pmh.vn', 'a@pmh.vn,b@pmh.vn', 'a@pmh.vn;'])(
    '%j → không hợp lệ',
    (value) => {
      expect(isEmail(value)).toBe(false);
    },
  );
});

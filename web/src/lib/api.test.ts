import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';

// Throttler chung trả câu tiếng Việt kèm số giây; màn phải hiện nguyên câu đó, không câu chung chung.
describe('errorMessage — 429 của throttler chung', () => {
  it('hiện đúng câu "thử lại sau N giây" và nhận ra mã RATE_LIMITED', () => {
    const error = new ApiError(429, {
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Thao tác quá nhanh, thử lại sau 42 giây.',
      retryAfter: 42,
    });
    expect(errorMessage(error, 'fallback')).toBe('Thao tác quá nhanh, thử lại sau 42 giây.');
    expect(errorCode(error)).toBe('RATE_LIMITED');
  });
});

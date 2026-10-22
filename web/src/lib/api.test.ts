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

/**
 * FM-07: mất mạng / máy chủ sập / thiếu quyền đều ra "Có lỗi xảy ra." — người dùng trên điện
 * thoại wifi chập chờn không biết nên làm gì. Không có câu của API thì nói theo NGUYÊN NHÂN.
 */
describe('errorMessage — không có câu của API thì nói theo nguyên nhân', () => {
  it('mất kết nối (fetch reject, không phải ApiError)', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  });
  it('máy chủ lỗi 5xx', () => {
    expect(errorMessage(new ApiError(502, null), 'fallback')).toBe('Máy chủ IMS đang lỗi. Thử lại sau ít phút.');
  });
  it('403 không kèm câu', () => {
    expect(errorMessage(new ApiError(403, null), 'fallback')).toBe('Bạn không có quyền làm việc này.');
  });
  it('API có câu thì vẫn dùng đúng câu của API', () => {
    expect(errorMessage(new ApiError(409, { message: 'Mã đã có.' }), 'fallback')).toBe('Mã đã có.');
  });
  it('lỗi khác không rõ nguyên nhân: câu của nơi gọi', () => {
    expect(errorMessage(new ApiError(400, null), 'fallback')).toBe('fallback');
  });
});

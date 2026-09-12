import { ArgumentsHost, HttpException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

function mockHost(headersSent = false) {
  const response = {
    headersSent,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('GlobalExceptionFilter — nhánh biên', () => {
  const filter = new GlobalExceptionFilter();

  it('HttpException payload null → vẫn trả đúng shape, không TypeError', () => {
    const { host, response } = mockHost();
    filter.catch(new HttpException(null as never, 400), host);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: expect.any(String),
    });
  });

  it('headers đã gửi → không ghi response lần hai (tránh ERR_HTTP_HEADERS_SENT)', () => {
    const { host, response } = mockHost(true);
    filter.catch(new Error('boom'), host);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('lỗi không đoán trước → 500 INTERNAL_ERROR, không lộ chi tiết', () => {
    const { host, response } = mockHost();
    filter.catch(new Error('bí mật nội bộ'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      /* Câu 500 dịch sang tiếng Việt 12/09 — và vẫn CHUNG CHUNG, đó mới là điểm của nó.
         Bài này chốt đúng chuỗi ấy để không ai 'tiện tay' thêm chi tiết nội bộ vào. */
      message:
        'Máy chủ gặp lỗi không mong đợi. Thử lại sau ít phút; nếu vẫn vậy thì báo bộ phận IT.',
    });
  });
});

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
      /* Câu 500 tiếng Việt — và vẫn CHUNG CHUNG, đó mới là điểm của nó.
         Bài này chốt đúng chuỗi ấy để không ai 'tiện tay' thêm chi tiết nội bộ vào. */
      message:
        'Máy chủ gặp lỗi không mong đợi. Thử lại sau ít phút; nếu vẫn vậy thì báo phòng IT.',
    });
  });

  /** Hình dạng thật: drizzle bọc lỗi pg trong `cause`, message chở tham số đã bind. */
  function pgFailure(code: string): Error {
    return Object.assign(new Error('Failed query: insert into "x" params: bí mật'), {
      cause: Object.assign(new Error('duplicate'), { code }),
    });
  }

  it.each([
    ['23505', 'CONFLICT_DUPLICATE'],
    ['40P01', 'CONFLICT_RETRY'],
    ['40001', 'CONFLICT_RETRY'],
  ])('lỗi pg %s mà service quên dịch → 409 %s, không phải 500, không lộ câu SQL', (code, expected) => {
    const { host, response } = mockHost();
    filter.catch(pgFailure(code), host);
    expect(response.status).toHaveBeenCalledWith(409);
    const body = response.json.mock.calls[0][0] as { code: string; message: string };
    expect(body.code).toBe(expected);
    expect(body.message).not.toMatch(/insert|bí mật/);
  });

  it('chờ khoá quá lock_timeout (55P03) → 409 CONFLICT_RETRY: người khác đang giữ dữ liệu, thử lại được', () => {
    const { host, response } = mockHost();
    filter.catch(pgFailure('55P03'), host);
    expect(response.status).toHaveBeenCalledWith(409);
    expect((response.json.mock.calls[0][0] as { code: string }).code).toBe('CONFLICT_RETRY');
  });

  it('câu lệnh quá statement_timeout (57014) → 503 DB_TIMEOUT có câu tiếng Việt, không phải 500 chung', () => {
    const { host, response } = mockHost();
    filter.catch(pgFailure('57014'), host);
    expect(response.status).toHaveBeenCalledWith(503);
    const body = response.json.mock.calls[0][0] as { code: string; message: string };
    expect(body.code).toBe('DB_TIMEOUT');
    expect(body.message).not.toMatch(/insert|bí mật/);
  });

  it('mã pg khác (vi phạm khoá ngoại) vẫn là 500 chung chung', () => {
    const { host, response } = mockHost();
    filter.catch(pgFailure('23503'), host);
    expect(response.status).toHaveBeenCalledWith(500);
  });
});

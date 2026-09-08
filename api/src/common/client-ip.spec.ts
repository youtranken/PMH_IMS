import { clientIp } from './client-ip';

/**
 * `req.ip` (Express đã áp `trust proxy = 1`) là NGUỒN DUY NHẤT cho IP client.
 *
 * Bài này khóa lại kết luận của rà soát 07/09 finding #1: đọc `X-Forwarded-For` thô là sai
 * vì nginx NỐI THÊM vào giá trị client gửi lên (`$proxy_add_x_forwarded_for`), nên phần tử
 * trái nhất chính là thứ nghi phạm tự điền.
 */
describe('clientIp', () => {
  it('trả đúng req.ip', () => {
    expect(clientIp({ ip: '192.168.1.50' })).toBe('192.168.1.50');
  });

  it('không có req.ip → null (không phải undefined, không phải chuỗi rỗng)', () => {
    expect(clientIp({})).toBeNull();
    expect(clientIp({ ip: undefined })).toBeNull();
  });

  /**
   * Hàng rào hồi quy: dù client bịa `X-Forwarded-For` thế nào, hàm này cũng không nhìn tới.
   * Nếu ai đó "sửa cho đầy đủ" bằng cách đọc lại header, bài này đỏ.
   */
  it('KHÔNG đọc X-Forwarded-For dù client có gửi', () => {
    const req = {
      ip: '192.168.1.50',
      headers: { 'x-forwarded-for': '1.2.3.4, 192.168.1.50' },
    };
    expect(clientIp(req)).toBe('192.168.1.50');
  });
});

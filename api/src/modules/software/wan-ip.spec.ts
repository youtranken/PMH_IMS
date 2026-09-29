import { wanIpOf } from './wan-ip';

describe('wanIpOf — IP WAN của đường truyền (cột inet, Q-04)', () => {
  it.each([
    ['113.161.10.20', '113.161.10.20'],
    ['  113.161.10.20 ', '113.161.10.20'],
    ['113.161.20.16/29', '113.161.20.16/29'],
    ['0.0.0.0/0', '0.0.0.0/0'],
    // Postgres in inet /32 thành địa chỉ trần; ghi cùng dạng thì lịch sử không báo đổi ma.
    ['203.0.113.10/32', '203.0.113.10'],
  ])('%s → %s', (raw, value) => {
    expect(wanIpOf(raw)).toEqual({ value, valid: true });
  });

  it.each(['', '   '])('chuỗi rỗng "%s" là bỏ IP', (raw) => {
    expect(wanIpOf(raw)).toEqual({ value: null, valid: true });
  });

  it.each([
    'động',
    '113.161.10',
    '113.161.10.256',
    '010.1.1.1',
    '113.161.10.20/33',
    '113.161.10.20/',
    '113.161.10.20/029',
    '113.161.10.20 - 113.161.10.25',
    '2001:db8::1',
  ])('%s bị từ chối', (raw) => {
    expect(wanIpOf(raw)).toEqual({ value: null, valid: false });
  });
});

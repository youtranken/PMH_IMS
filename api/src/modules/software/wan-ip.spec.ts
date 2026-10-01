import { MAX_WAN_IPS, wanIpsOf } from './wan-ip';

describe('wanIpsOf — danh sách IP WAN của một đường truyền (Q-20)', () => {
  it.each([
    [['113.161.10.20'], ['113.161.10.20']],
    [['  113.161.10.20 '], ['113.161.10.20']],
    [['113.161.10.20', '113.161.10.21', '203.0.113.9'], ['113.161.10.20', '113.161.10.21', '203.0.113.9']],
    // Ô trống trong form (bấm "Thêm IP" rồi bỏ đó) không phải một IP.
    [['', '113.161.10.20', '   '], ['113.161.10.20']],
    // Trùng trong cùng một đường: giữ lần đầu, giữ thứ tự người nhập.
    [['113.161.10.21', '113.161.10.20', ' 113.161.10.21'], ['113.161.10.21', '113.161.10.20']],
    [[], []],
  ])('%j → %j', (raw, value) => {
    expect(wanIpsOf(raw)).toEqual({ value, reason: null, bad: null });
  });

  it.each([
    'động',
    '113.161.10',
    '113.161.10.256',
    '010.1.1.1',
    '113.161.10.20 - 113.161.10.25',
    '113.161.10.20,113.161.10.21',
    '2001:db8::1',
  ])('"%s" không phải một IPv4', (raw) => {
    expect(wanIpsOf(['113.161.10.20', raw])).toEqual({ value: [], reason: 'invalid', bad: raw });
  });

  // Nhà mạng chỉ cấp từng IP; một dải gõ vào trông hợp lệ nhưng đọc sai số IP thật đang dùng.
  it.each(['113.161.20.16/29', '203.0.113.10/32', '113.161.10.20/'])('"%s" là dải, bị từ chối', (raw) => {
    expect(wanIpsOf([raw])).toEqual({ value: [], reason: 'range', bad: raw });
  });

  it(`quá ${MAX_WAN_IPS} IP thì từ chối cả danh sách`, () => {
    const many = Array.from({ length: MAX_WAN_IPS + 1 }, (_v, i) => `10.0.0.${i + 1}`);
    expect(wanIpsOf(many)).toEqual({ value: [], reason: 'too_many', bad: null });
    expect(wanIpsOf(many.slice(0, MAX_WAN_IPS)).value).toHaveLength(MAX_WAN_IPS);
  });
});

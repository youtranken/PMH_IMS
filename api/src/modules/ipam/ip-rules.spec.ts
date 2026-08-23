import {
  addressToLong,
  enumerateHosts,
  isHostInSubnet,
  longToAddress,
  normalizeSubnet,
  parseAddress,
  subnetUsage,
  usableHostCount,
} from './ip-rules';

describe('parseAddress — nhận đúng một địa chỉ IPv4', () => {
  it.each([
    ['172.16.10.5', true],
    ['0.0.0.0', true],
    ['255.255.255.255', true],
    ['172.16.10', false],
    ['172.16.10.5.6', false],
    ['172.16.10.256', false],
    ['172.16.010.5', false],
    ['172.16.10.-1', false],
    ['172.16.10.5/24', false],
    ['  ', false],
    ['fe80::1', false],
  ])('%s → %s', (value, ok) => {
    expect(parseAddress(value).ok).toBe(ok);
  });

  /**
   * "010" bị từ chối chứ không đọc thành 10: nhiều thư viện đọc số bắt đầu bằng 0 theo hệ
   * bát phân, nên `172.16.010.5` thành `172.16.8.5` — cấp một IP mà tưởng là cấp IP khác.
   * Chặn ở cửa vào rẻ hơn nhiều so với truy vết một xung đột IP ngoài mạng.
   */
  it('số có số 0 đứng đầu bị từ chối, không âm thầm đọc thành hệ 8', () => {
    expect(parseAddress('172.16.010.5').ok).toBe(false);
  });
});

describe('normalizeSubnet — chuẩn hóa dải', () => {
  it('quy về địa chỉ mạng: người ta hay gõ IP bất kỳ kèm /24', () => {
    const result = normalizeSubnet('172.16.10.37/24');
    expect(result.ok).toBe(true);
    expect(result.ok && result.cidr).toBe('172.16.10.0/24');
  });

  it.each([
    ['172.16.10.0/24', '172.16.10.0/24'],
    ['10.0.0.0/8', '10.0.0.0/8'],
    ['192.168.1.0/30', '192.168.1.0/30'],
  ])('%s → %s', (input, expected) => {
    const result = normalizeSubnet(input);
    expect(result.ok && result.cidr).toBe(expected);
  });

  it.each(['172.16.10.0', '172.16.10.0/33', '172.16.10.0/-1', '172.16.10.0/abc', 'fe80::/64'])(
    'từ chối %s',
    (value) => {
      expect(normalizeSubnet(value).ok).toBe(false);
    },
  );

  /**
   * /7 trở lên rộng hơn 33 triệu địa chỉ. Màn "IP trống còn lại" sẽ phải dựng danh sách đó,
   * và không ai khai subnet /7 trong mạng LAN của PMH — gần như chắc chắn là gõ nhầm /27.
   */
  it('dải rộng quá mức hợp lý bị chặn kèm lời giải thích', () => {
    const result = normalizeSubnet('10.0.0.0/7');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('too_wide');
  });
});

describe('isHostInSubnet — IP ngoài dải bị từ chối', () => {
  it.each([
    ['172.16.10.5', '172.16.10.0/24', true],
    ['172.16.10.255', '172.16.10.0/24', true],
    ['172.16.11.5', '172.16.10.0/24', false],
    ['10.0.0.1', '172.16.10.0/24', false],
    ['192.168.1.2', '192.168.1.0/30', true],
    ['192.168.1.5', '192.168.1.0/30', false],
  ])('%s trong %s → %s', (address, cidr, expected) => {
    expect(isHostInSubnet(address, cidr)).toBe(expected);
  });
});

describe('usableHostCount — đếm địa chỉ CẤP ĐƯỢC, không phải tổng địa chỉ', () => {
  it.each([
    ['172.16.10.0/24', 254],
    ['172.16.10.0/25', 126],
    ['192.168.1.0/30', 2],
    // /31 dùng cho link point-to-point (RFC 3021): cả hai địa chỉ đều cấp được.
    ['192.168.1.0/31', 2],
    // /32 là đúng một máy — không có địa chỉ mạng/quảng bá để trừ.
    ['192.168.1.7/32', 1],
  ])('%s → %s', (cidr, expected) => {
    expect(usableHostCount(cidr)).toBe(expected);
  });

  /**
   * Trừ địa chỉ mạng và địa chỉ quảng bá là chỗ dễ quên nhất. Quên thì màn subnet báo
   * "còn 256 IP trống" trong khi thực tế còn 254 — và hai cái tưởng-trống đó cấp cho máy
   * nào là máy đó không ra được mạng.
   */
  it('/24 là 254 chứ không phải 256', () => {
    expect(usableHostCount('172.16.10.0/24')).toBe(254);
  });
});

describe('enumerateHosts — dựng danh sách địa chỉ cấp được', () => {
  it('/30 cho đúng hai địa chỉ giữa', () => {
    expect(enumerateHosts('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('/24 bỏ .0 và .255', () => {
    const hosts = enumerateHosts('172.16.10.0/24');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('172.16.10.1');
    expect(hosts[253]).toBe('172.16.10.254');
    expect(hosts).not.toContain('172.16.10.0');
    expect(hosts).not.toContain('172.16.10.255');
  });

  it('/31 cho cả hai địa chỉ (link point-to-point)', () => {
    expect(enumerateHosts('192.168.1.0/31')).toEqual(['192.168.1.0', '192.168.1.1']);
  });
});

describe('subnetUsage — FR-020 phần trăm đã cấp', () => {
  it('đếm theo địa chỉ CẤP ĐƯỢC, không theo tổng', () => {
    expect(subnetUsage('172.16.10.0/24', 127)).toEqual({ total: 254, used: 127, free: 127, percent: 50 });
  });

  it('subnet rỗng là 0%, không phải NaN', () => {
    expect(subnetUsage('172.16.10.0/24', 0)).toMatchObject({ percent: 0, free: 254 });
  });

  it('làm tròn tới số nguyên — "49,6%" không nói thêm được gì so với "50%"', () => {
    expect(subnetUsage('172.16.10.0/24', 126).percent).toBe(50);
    expect(subnetUsage('172.16.10.0/24', 1).percent).toBe(0);
  });

  /**
   * Dữ liệu lệch (đếm nhiều hơn số cấp được) không được cho ra 103% hay số âm: màn hình
   * hiện thanh tiến trình tràn ra ngoài, còn người đọc thì mất lòng tin vào cả trang.
   */
  it('kẹp trong khoảng 0–100 nếu dữ liệu lệch', () => {
    expect(subnetUsage('192.168.1.0/30', 5)).toEqual({ total: 2, used: 5, free: 0, percent: 100 });
  });
});

describe('addressToLong / longToAddress — đi và về không mất mát', () => {
  it.each(['0.0.0.0', '172.16.10.5', '255.255.255.255'])('%s', (address) => {
    expect(longToAddress(addressToLong(address))).toBe(address);
  });

  /** Bit cao của 255.x.x.x làm phép dịch bit trong JS ra số ÂM — phải dùng >>> 0. */
  it('địa chỉ có bit cao bật không ra số âm', () => {
    expect(addressToLong('255.255.255.255')).toBe(4_294_967_295);
  });
});

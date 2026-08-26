import {
  addressToLong,
  enumerateHosts,
  hostRole,
  hostRoleIn,
  isHostInSubnet,
  longToAddress,
  normalizeSubnet,
  parseAddress,
  subnetUsage,
  usableHostCount,
} from './ip-rules';

describe('hostRole — địa chỉ mạng và địa chỉ quảng bá KHÔNG cấp cho máy được', () => {
  /**
   * Không biết dải thì suy từ octet cuối. Đúng tuyệt đối trong hệ này vì `MIN_PREFIX = 24`:
   * mọi dải khai được đều là /24 hoặc hẹp hơn, và trong MỌI dải như vậy octet cuối 0 là địa
   * chỉ mạng còn 255 là địa chỉ quảng bá (kiểm cả /25, /26 ở nhóm dưới).
   */
  it.each([
    ['172.16.10.0', 'network'],
    ['172.16.0.0', 'network'],
    ['10.0.0.0', 'network'],
    ['172.16.10.255', 'broadcast'],
    ['192.168.1.255', 'broadcast'],
    ['172.16.10.1', 'host'],
    ['172.16.10.254', 'host'],
    ['172.16.10.128', 'host'],
  ])('%s → %s', (address, expected) => {
    expect(hostRole(address)).toBe(expected);
  });

  it('chuỗi không phải IPv4 thì trả về null, không đoán bừa', () => {
    expect(hostRole('không phải ip')).toBeNull();
    expect(hostRole('172.16.10')).toBeNull();
  });
});

describe('hostRoleIn — biết dải thì soi ĐÚNG dải đó', () => {
  /** /26 có bốn dải con: biên rơi vào .64/.128/.192 chứ không chỉ .0 và .255. */
  it.each([
    ['172.16.10.64', '172.16.10.64/26', 'network'],
    ['172.16.10.127', '172.16.10.64/26', 'broadcast'],
    ['172.16.10.65', '172.16.10.64/26', 'host'],
    ['172.16.10.126', '172.16.10.64/26', 'host'],
    ['172.16.10.128', '172.16.10.128/25', 'network'],
    ['172.16.10.255', '172.16.10.128/25', 'broadcast'],
    ['172.16.10.0', '172.16.10.0/24', 'network'],
    ['172.16.10.255', '172.16.10.0/24', 'broadcast'],
    ['172.16.10.5', '172.16.10.0/24', 'host'],
  ])('%s trong %s → %s', (address, cidr, expected) => {
    expect(hostRoleIn(address, cidr)).toBe(expected);
  });

  it('IP ngoài dải trả về null — câu hỏi không có nghĩa, đừng bịa câu trả lời', () => {
    expect(hostRoleIn('172.16.99.5', '172.16.10.0/24')).toBeNull();
  });

  /**
   * /31 (RFC 3021, link point-to-point giữa hai router) và /32 KHÔNG có địa chỉ mạng hay
   * quảng bá — cả hai đầu đều dùng được. `usableHostCount` đã chừa ngoại lệ này rồi.
   */
  it.each([
    ['10.0.0.0', '10.0.0.0/31'],
    ['10.0.0.1', '10.0.0.0/31'],
    ['10.0.0.7', '10.0.0.7/32'],
  ])('%s trong %s vẫn là host dùng được', (address, cidr) => {
    expect(hostRoleIn(address, cidr)).toBe('host');
  });
});

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
    ['192.168.1.0/28', '192.168.1.0/28'],
    ['192.168.1.0/30', '192.168.1.0/30'],
    ['10.20.30.40/32', '10.20.30.40/32'],
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
   * Trần là /24 (254 host) — quyết định của chủ dự án, 25/08/2026.
   *
   * Lý do không phải thẩm mỹ: màn chi tiết dải liệt kê MỌI host trong dải, không phân trang.
   * Gõ nhầm /16 thay /24 là 65.534 dòng dựng một lượt (treo tab), /8 là 16 triệu (treo cả
   * server vì `enumerateHosts` chạy đồng bộ). Chặn ngay từ lúc khai dải rẻ hơn nhiều so với
   * chặn ở tầng hiển thị. Cần dải rộng hơn thì chia thành nhiều dải /24.
   */
  it.each(['10.0.0.0/7', '10.0.0.0/8', '172.16.0.0/16', '172.16.0.0/23'])(
    'dải rộng hơn /24 bị chặn kèm lời giải thích: %s',
    (value) => {
      const result = normalizeSubnet(value);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe('too_wide');
    },
  );
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

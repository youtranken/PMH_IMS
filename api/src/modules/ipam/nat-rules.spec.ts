import {
  describePortRange,
  parsePortRange,
  protocolsOverlap,
  rangesOverlap,
  validateNatRule,
  natChanges,
  type NatRuleSnapshot,
} from './nat-rules';

describe('parsePortRange — người ta gõ "8080" hoặc "8000-8010"', () => {
  it.each([
    ['8080', { from: 8080, to: 8080 }],
    ['8000-8010', { from: 8000, to: 8010 }],
    ['  443 ', { from: 443, to: 443 }],
    ['1-65535', { from: 1, to: 65535 }],
  ])('%s → %o', (input, expected) => {
    const result = parsePortRange(input);
    expect(result.ok && result).toMatchObject(expected);
  });

  it.each([
    ['0', 'range'],
    ['65536', 'range'],
    ['8010-8000', 'reversed'],
    ['8080-', 'format'],
    ['abc', 'format'],
    ['', 'format'],
    ['80,443', 'format'],
  ])('từ chối %s (%s)', (input, reason) => {
    const result = parsePortRange(input);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(reason);
  });

  /**
   * Khoảng viết ngược (8010-8000) phải báo RIÊNG, không gộp vào "sai định dạng": người gõ
   * biết mình muốn gì, chỉ đảo hai đầu — nói đúng chỗ sai thì họ sửa trong hai giây.
   */
  it('khoảng viết ngược được nói riêng, không gộp vào "sai định dạng"', () => {
    const result = parsePortRange('8010-8000');
    expect(result.ok === false && result.reason).toBe('reversed');
  });
});

describe('describePortRange', () => {
  it.each([
    [8080, 8080, '8080'],
    [8000, 8010, '8000-8010'],
  ])('%s..%s → %s', (from, to, expected) => {
    expect(describePortRange(from, to)).toBe(expected);
  });
});

describe('validateNatRule — luật nghiệp vụ của một dòng sổ NAT (FR-017)', () => {
  const base = {
    externalFrom: 8080,
    externalTo: 8080,
    internalIp: '172.16.10.5',
    internalPort: 80,
    usedBy: 'Chị Lan — Kế toán',
    reason: 'máy chấm công cần truy cập từ ngoài',
  };

  /** Ngưỡng cảnh báo mặc định đã seed (`nat.wide_port_range`). */
  const check = (draft: typeof base, subnetCidr?: string | null) =>
    validateNatRule(draft, { subnetCidr, widePortRange: 1000 });

  it('dòng đầy đủ thì hợp lệ, không lỗi không cảnh báo', () => {
    expect(check(base)).toEqual({ errors: [], warnings: [] });
  });

  /**
   * `reason` và `used_by` bắt buộc — đó là LÝ DO bảng này tồn tại. Story viết rõ: auditor hỏi
   * "port nào mở, vì sao, cho ai" phải trả lời được ngay. Một dòng thiếu lý do là một dòng
   * sáu tháng sau không ai dám đóng vì không biết nó phục vụ ai.
   */
  it.each([
    ['reason', { reason: '   ' }],
    ['usedBy', { usedBy: '' }],
  ])('thiếu %s thì từ chối', (_field, over) => {
    expect(check({ ...base, ...over }).errors.length).toBe(1);
  });

  it('IP trong phải là IPv4 hợp lệ', () => {
    expect(check({ ...base, internalIp: '172.16.10.999' }).errors.length).toBe(1);
    expect(check({ ...base, internalIp: 'fe80::1' }).errors.length).toBe(1);
  });

  /**
   * Địa chỉ mạng và địa chỉ quảng bá KHÔNG phải máy nào cả.
   *
   * Chỉ hỏi "có phải IPv4 hợp lệ không" thì `172.16.0.0` khai được và cuốn
   * sổ có một dòng dẫn tới hư không: gói tin chuyển tới đó không tới máy nào, còn người đọc
   * sổ thì tin rằng port ấy đang phục vụ một dịch vụ thật.
   */
  it.each([
    ['172.16.0.0', 'địa chỉ mạng'],
    ['172.16.10.0', 'địa chỉ mạng'],
    ['172.16.10.255', 'địa chỉ quảng bá'],
  ])('IP trong = %s bị từ chối (%s)', (internalIp) => {
    const errors = check({ ...base, internalIp }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/địa chỉ (mạng|quảng bá)/i);
  });

  it.each([['172.16.10.1'], ['172.16.10.128'], ['172.16.10.254']])(
    'IP trong = %s vẫn khai được bình thường',
    (internalIp) => {
      expect(check({ ...base, internalIp }).errors).toEqual([]);
    },
  );

  /**
   * BE-07 — biết dải chứa IP thì xét theo prefix của dải, không đoán theo octet cuối: trong dải
   * hẹp hơn /24, địa chỉ mạng/quảng bá nằm giữa chừng, còn /31 và /32 thì không có hai địa chỉ đó.
   */
  it.each([
    ['172.16.10.127', '172.16.10.0/25', 'broadcast'],
    ['172.16.10.128', '172.16.10.128/25', 'network'],
    ['172.16.10.64', '172.16.10.64/26', 'network'],
    ['172.16.10.191', '172.16.10.128/26', 'broadcast'],
    ['172.16.10.3', '172.16.10.0/30', 'broadcast'],
    ['172.16.10.126', '172.16.10.0/25', 'host'],
    ['172.16.10.255', '172.16.10.254/31', 'host'],
    ['172.16.10.0', '172.16.10.0/31', 'host'],
    ['172.16.10.255', '172.16.10.255/32', 'host'],
    ['172.16.10.5', '172.16.10.0/24', 'host'],
    ['172.16.10.0', '172.16.10.0/24', 'network'],
  ])('IP %s trong dải %s → %s', (internalIp, cidr, role) => {
    const errors = check({ ...base, internalIp }, cidr).errors;
    if (role === 'host') expect(errors).toEqual([]);
    else expect(errors.join(' ')).toMatch(role === 'network' ? /địa chỉ mạng/i : /địa chỉ quảng bá/i);
  });

  it('IP không thuộc dải nào đã khai → vẫn chặn .0/.255 theo octet cuối', () => {
    expect(check({ ...base, internalIp: '10.9.9.255' }, null).errors).toHaveLength(1);
    expect(check({ ...base, internalIp: '10.9.9.7' }, null).errors).toEqual([]);
  });

  /** Sai định dạng báo MỘT lỗi định dạng, không kèm thêm lỗi "địa chỉ mạng" vô nghĩa. */
  it('IP sai định dạng chỉ báo lỗi định dạng, không báo chồng', () => {
    expect(check({ ...base, internalIp: '172.16.10.999' }).errors).toHaveLength(1);
  });

  it('port trong phải trong khoảng 1–65535', () => {
    expect(check({ ...base, internalPort: 0 }).errors.length).toBe(1);
    expect(check({ ...base, internalPort: 70000 }).errors.length).toBe(1);
  });

  /**
   * `NatRuleService.create` là hàm công khai — import Excel về
   * sau, seed, hay module khác gọi lại đều KHÔNG đi qua DTO HTTP. Không kiểm ở đây thì cặp
   * ngược đầu rơi xuống ràng buộc của Postgres và bung 500 thay vì một câu tiếng Việt.
   */
  it('port NGOÀI cũng phải hợp lệ, không chỉ trông vào bộ phân tích chuỗi của controller', () => {
    expect(check({ ...base, externalFrom: 0, externalTo: 10 }).errors.length).toBe(1);
    expect(check({ ...base, externalFrom: 1, externalTo: 70000 }).errors.length).toBe(1);
  });

  it('khoảng port ngoài viết ngược bị từ chối kèm ví dụ đúng', () => {
    const { errors } = check({ ...base, externalFrom: 8020, externalTo: 8010 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('8000-8010');
  });

  /**
   * Loại lỗi tệ nhất: thông điệp nói "nếu đúng ý thì cứ lưu" mà code lại NÉM — người dùng đọc
   * được lời khuyên mà không làm theo được. Chỉ đếm `errors.length === 1` thì bài XANH trong
   * khi hành vi sai, nên khẳng định đúng chỗ: đây là `warnings`, và `errors` phải RỖNG.
   */
  it('mở dải port lớn là CẢNH BÁO, không phải lỗi — dải camera phải lưu được', () => {
    const result = check({ ...base, externalFrom: 50000, externalTo: 52000 });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('1000');
  });

  // Ngưỡng đọc từ `system_config` (AD-11): hạ xuống 100 thì dải 200 cổng đã phải cảnh báo.
  it('ngưỡng cảnh báo là tham số, không phải hằng số', () => {
    const wide = { ...base, externalFrom: 8000, externalTo: 8199 };
    expect(validateNatRule(wide, { widePortRange: 1000 }).warnings).toEqual([]);
    const tight = validateNatRule(wide, { widePortRange: 100 });
    expect(tight.errors).toEqual([]);
    expect(tight.warnings[0]).toContain('100');
  });

  it('dải ngược đầu KHÔNG lọt qua ô cảnh báo bằng độ rộng âm', () => {
    const result = check({ ...base, externalFrom: 60000, externalTo: 100 });
    expect(result.errors.length).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('gom HẾT lỗi của một dòng, không dừng ở lỗi đầu tiên', () => {
    const result = check({
      ...base,
      reason: '',
      usedBy: '',
      internalIp: 'sai',
      internalPort: 0,
    });
    expect(result.errors.length).toBe(4);
  });
});

/**
 * Ràng buộc `EXCLUDE` của DB so `protocol WITH =` nên `both`
 * và `tcp` cùng port KHÔNG đụng nhau ở tầng DB — trong khi `both` theo định nghĩa phủ cả TCP
 * lẫn UDP. Sổ NAT khi đó có HAI câu trả lời cho TCP/8080, đúng thứ bảng này sinh ra để tránh.
 */
describe('protocolsOverlap — `both` phủ cả hai, `tcp` và `udp` thì không', () => {
  it.each([
    ['tcp', 'tcp', true],
    ['udp', 'udp', true],
    ['both', 'both', true],
    ['both', 'tcp', true],
    ['tcp', 'both', true],
    ['both', 'udp', true],
    ['udp', 'both', true],
    // Draytek cho khai riêng TCP và UDP cùng port — chặn là chặn nhầm việc hợp lệ.
    ['tcp', 'udp', false],
    ['udp', 'tcp', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(protocolsOverlap(a, b)).toBe(expected);
  });
});

describe('rangesOverlap — biên tính vào', () => {
  it.each([
    [8000, 8010, 8005, 8020, true],
    [8000, 8010, 8010, 8020, true],
    [8000, 8010, 8011, 8020, false],
    [8080, 8080, 8080, 8080, true],
    [8000, 8010, 7000, 7999, false],
    // Bao trọn: dải nhỏ nằm hẳn trong dải lớn.
    [1000, 60000, 8080, 8080, true],
  ])('%s-%s vs %s-%s → %s', (aFrom, aTo, bFrom, bTo, expected) => {
    expect(rangesOverlap(aFrom, aTo, bFrom, bTo)).toBe(expected);
  });
});

/**
 * `natChanges` là thứ tab Lịch sử của sổ NAT đọc. Nó phải trả lời đúng câu "cái gì đổi từ đâu
 * sang đâu" — không phải chép lại cả bản ghi, cũng không đẻ dòng cho những ô không ai đụng.
 */
describe('natChanges — ô nào của rule NAT thật sự đổi', () => {
  const base: NatRuleSnapshot = {
    ports: '8080',
    protocol: 'tcp',
    internalIp: '172.16.10.5',
    internalPort: 80,
    usedBy: 'Camera tầng 2',
    reason: 'Xem camera từ ngoài',
    enabled: true,
    note: null,
  };

  it('không đổi gì thì không đẻ dòng nào', () => {
    expect(natChanges(base, { ...base })).toEqual({});
  });

  it('nới dải port ra thì ghi thành MỘT ô, không phải hai con số rời', () => {
    expect(natChanges(base, { ...base, ports: '8080-8090' })).toEqual({
      ports: { before: '8080', after: '8080-8090' },
    });
  });

  it('tắt rule ghi được cả giá trị boolean', () => {
    expect(natChanges(base, { ...base, enabled: false })).toEqual({
      enabled: { before: true, after: false },
    });
  });

  it('đổi nhiều ô một lúc thì ghi đủ, không gộp', () => {
    const changes = natChanges(base, {
      ...base,
      internalIp: '172.16.10.9',
      usedBy: 'Đầu ghi NVR',
    });
    expect(Object.keys(changes).sort()).toEqual(['internalIp', 'usedBy']);
  });

  /*
   * Ô ghi chú đang trống, người dùng bấm vào rồi bấm ra: form gửi lên chuỗi rỗng còn DB đang
   * giữ null. Không chuẩn hóa thì mỗi lần mở form ra đóng lại là một dòng lịch sử rác.
   */
  it('rỗng kiểu nào cũng là rỗng — không đẻ dòng rác', () => {
    expect(natChanges(base, { ...base, note: '' })).toEqual({});
  });

  it('thêm ghi chú thật thì có ghi', () => {
    expect(natChanges(base, { ...base, note: 'mở theo yêu cầu anh Dũng' })).toEqual({
      note: { before: null, after: 'mở theo yêu cầu anh Dũng' },
    });
  });
});

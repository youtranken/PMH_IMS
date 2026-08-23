import {
  describePortRange,
  parsePortRange,
  protocolsOverlap,
  rangesOverlap,
  validateNatRule,
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

  it('dòng đầy đủ thì hợp lệ, không lỗi không cảnh báo', () => {
    expect(validateNatRule(base)).toEqual({ errors: [], warnings: [] });
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
    expect(validateNatRule({ ...base, ...over }).errors.length).toBe(1);
  });

  it('IP trong phải là IPv4 hợp lệ', () => {
    expect(validateNatRule({ ...base, internalIp: '172.16.10.999' }).errors.length).toBe(1);
    expect(validateNatRule({ ...base, internalIp: 'fe80::1' }).errors.length).toBe(1);
  });

  it('port trong phải trong khoảng 1–65535', () => {
    expect(validateNatRule({ ...base, internalPort: 0 }).errors.length).toBe(1);
    expect(validateNatRule({ ...base, internalPort: 70000 }).errors.length).toBe(1);
  });

  /**
   * Code review Epic 5, finding 2: `NatRuleService.create` là hàm công khai — import Excel về
   * sau, seed, hay module khác gọi lại đều KHÔNG đi qua DTO HTTP. Không kiểm ở đây thì cặp
   * ngược đầu rơi xuống ràng buộc của Postgres và bung 500 thay vì một câu tiếng Việt.
   */
  it('port NGOÀI cũng phải hợp lệ, không chỉ trông vào bộ phân tích chuỗi của controller', () => {
    expect(validateNatRule({ ...base, externalFrom: 0, externalTo: 10 }).errors.length).toBe(1);
    expect(validateNatRule({ ...base, externalFrom: 1, externalTo: 70000 }).errors.length).toBe(1);
  });

  it('khoảng port ngoài viết ngược bị từ chối kèm ví dụ đúng', () => {
    const { errors } = validateNatRule({ ...base, externalFrom: 8020, externalTo: 8010 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('8000-8010');
  });

  /**
   * ĐÂY là finding số 1 của code review Epic 5, và là loại lỗi tệ nhất: comment nói "cảnh báo,
   * không chặn", thông điệp nói "nếu đúng ý thì cứ lưu", nhưng code lại NÉM — người dùng đọc
   * được lời khuyên mà không làm theo được. Test cũ chỉ đếm `errors.length === 1` nên nó XANH
   * trong khi hành vi sai. Giờ khẳng định đúng chỗ: đây là `warnings`, và `errors` phải RỖNG.
   */
  it('mở dải port lớn là CẢNH BÁO, không phải lỗi — dải camera phải lưu được', () => {
    const result = validateNatRule({ ...base, externalFrom: 50000, externalTo: 52000 });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('1000');
  });

  it('dải ngược đầu KHÔNG lọt qua ô cảnh báo bằng độ rộng âm', () => {
    const result = validateNatRule({ ...base, externalFrom: 60000, externalTo: 100 });
    expect(result.errors.length).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('gom HẾT lỗi của một dòng, không dừng ở lỗi đầu tiên', () => {
    const result = validateNatRule({
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
 * Code review Epic 5, finding 4: ràng buộc `EXCLUDE` của DB so `protocol WITH =` nên `both`
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

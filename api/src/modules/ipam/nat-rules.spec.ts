import { describePortRange, parsePortRange, validateNatRule } from './nat-rules';

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

  it('dòng đầy đủ thì hợp lệ', () => {
    expect(validateNatRule(base)).toEqual([]);
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
    expect(validateNatRule({ ...base, ...over }).length).toBe(1);
  });

  it('IP trong phải là IPv4 hợp lệ', () => {
    expect(validateNatRule({ ...base, internalIp: '172.16.10.999' }).length).toBe(1);
    expect(validateNatRule({ ...base, internalIp: 'fe80::1' }).length).toBe(1);
  });

  it('port trong phải trong khoảng 1–65535', () => {
    expect(validateNatRule({ ...base, internalPort: 0 }).length).toBe(1);
    expect(validateNatRule({ ...base, internalPort: 70000 }).length).toBe(1);
  });

  /**
   * Mở nguyên dải lớn ra Internet là chuyện có thật và rất tệ. Không CHẶN (đôi khi cần thật,
   * vd dải port của camera), nhưng phải nói ra — người khai cần biết mình vừa mở 1000 cổng.
   */
  it('cảnh báo khi mở dải port lớn, nhưng không chặn', () => {
    const errors = validateNatRule({ ...base, externalFrom: 1, externalTo: 65535 });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('1000');
  });

  it('gom HẾT lỗi của một dòng, không dừng ở lỗi đầu tiên', () => {
    const errors = validateNatRule({
      ...base,
      reason: '',
      usedBy: '',
      internalIp: 'sai',
      internalPort: 0,
    });
    expect(errors.length).toBe(4);
  });
});

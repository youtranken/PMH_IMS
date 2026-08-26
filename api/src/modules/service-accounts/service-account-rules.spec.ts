import {
  checkAllowedIps,
  supportsVpnFields,
  validateServiceAccount,
  type ServiceAccountDraft,
  type ServiceAccountKind,
} from './service-account-rules';

function draft(over: Partial<ServiceAccountDraft> = {}): ServiceAccountDraft {
  return { code: 'TK-KETOAN', kind: 'shared', name: 'Email kế toán', ...over };
}

describe('supportsVpnFields — ô nào thuộc loại nào', () => {
  const cases: { kind: ServiceAccountKind; expected: boolean }[] = [
    { kind: 'shared', expected: false },
    { kind: 'vpn', expected: true },
  ];
  for (const { kind, expected } of cases) {
    it(`${kind} → ${expected}`, () => {
      expect(supportsVpnFields(kind)).toBe(expected);
    });
  }
});

describe('checkAllowedIps — đọc danh sách IP được phép', () => {
  const good: { name: string; input: string; normalized: string[] }[] = [
    { name: 'một IP đơn', input: '203.113.1.5', normalized: ['203.113.1.5'] },
    { name: 'một dải CIDR', input: '203.113.1.0/24', normalized: ['203.113.1.0/24'] },
    {
      name: 'ngăn bằng dấu phẩy',
      input: '203.113.1.5, 118.70.2.0/24',
      normalized: ['203.113.1.5', '118.70.2.0/24'],
    },
    // Dán từ email thì hay xuống dòng thay vì dấu phẩy.
    {
      name: 'ngăn bằng xuống dòng',
      input: '203.113.1.5\n118.70.2.9',
      normalized: ['203.113.1.5', '118.70.2.9'],
    },
    { name: 'bỏ mục rỗng và khoảng trắng thừa', input: ' 1.2.3.4 , , ', normalized: ['1.2.3.4'] },
    { name: 'bỏ mục trùng', input: '1.2.3.4, 1.2.3.4', normalized: ['1.2.3.4'] },
    { name: '/32 vẫn hợp lệ', input: '8.8.8.8/32', normalized: ['8.8.8.8/32'] },
  ];

  for (const { name, input, normalized } of good) {
    it(name, () => {
      const result = checkAllowedIps(input);
      expect(result.invalid).toEqual([]);
      expect(result.normalized).toEqual(normalized);
    });
  }

  const bad = ['abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '1.2.3.4/33', '1.2.3.4/abc', '::1'];
  for (const input of bad) {
    it(`từ chối "${input}"`, () => {
      expect(checkAllowedIps(input).invalid).toEqual([input]);
    });
  }

  it('mục hỏng KHÔNG nuốt mất mục đúng đứng cạnh', () => {
    const result = checkAllowedIps('1.2.3.4, rác, 5.6.7.8');
    expect(result.invalid).toEqual(['rác']);
    expect(result.normalized).toEqual(['1.2.3.4', '5.6.7.8']);
  });

  const wide: { input: string; wide: boolean }[] = [
    { input: '10.0.0.0/8', wide: true },
    { input: '0.0.0.0/0', wide: true },
    { input: '10.0.0.0/9', wide: false },
    { input: '203.113.1.0/24', wide: false },
  ];
  for (const { input, wide: isWide } of wide) {
    it(`"${input}" ${isWide ? 'bị cảnh báo là quá rộng' : 'không bị cảnh báo'}`, () => {
      expect(checkAllowedIps(input).tooWide).toEqual(isWide ? [input] : []);
    });
  }
});

describe('validateServiceAccount', () => {
  it('hồ sơ dùng chung tối thiểu là hợp lệ', () => {
    expect(validateServiceAccount(draft())).toEqual({ errors: [], warnings: [] });
  });

  it('thiếu mã hoặc tên thì báo, và báo CẢ HAI trong một lần', () => {
    const result = validateServiceAccount(draft({ code: '  ', name: '' }));
    expect(result.errors).toHaveLength(2);
  });

  // Ô của loại khác lọt vào là dữ liệu vô nghĩa mà sáu tháng sau không ai dám xóa.
  it('tài khoản dùng chung không được có nhóm VPN hay dải IP', () => {
    const result = validateServiceAccount(
      draft({ groupName: 'vpn-ketoan', allowedIps: '1.2.3.4' }),
    );
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join(' ')).toContain('dùng chung');
  });

  it('tài khoản VPN thì hai ô đó hợp lệ', () => {
    const result = validateServiceAccount(
      draft({ kind: 'vpn', groupName: 'vpn-ketoan', allowedIps: '203.113.1.0/24' }),
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('VPN có dải IP sai định dạng thì chặn, nói rõ mục nào sai', () => {
    const result = validateServiceAccount(draft({ kind: 'vpn', allowedIps: '1.2.3.4, rác' }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('rác');
  });

  // Cảnh báo ≠ lỗi: mở rộng vẫn lưu được, nhưng phải nói ra.
  it('VPN mở dải quá rộng thì CẢNH BÁO chứ không chặn', () => {
    const result = validateServiceAccount(draft({ kind: 'vpn', allowedIps: '0.0.0.0/0' }));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

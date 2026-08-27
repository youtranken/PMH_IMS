import {
  checkAllowedIps,
  codeFromLogin,
  mergeServiceAccount,
  supportsVpnFields,
  validateServiceAccount,
  type ServiceAccountDraft,
  type ServiceAccountKind,
  type ServiceAccountOptionalField,
  type ServiceAccountPatch,
  type ServiceAccountStored,
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

/**
 * `mergeServiceAccount` là chỗ quyết định GIÁ TRỊ SẼ NẰM TRONG DB sau một lần ghi — và cũng
 * là chỗ hai lỗi im lặng từng đi qua: `PATCH` thiếu ô xoá trắng hồ sơ, và luật kiểm chạy trên
 * body nên không thấy dải IP cũ vẫn mở toang.
 */
describe('mergeServiceAccount — ghép body với dòng đang có', () => {
  const stored: ServiceAccountStored = {
    login: 'ketoan@pmh.com.vn',
    department: 'Kế toán',
    ownerName: 'Chị Lan',
    groupName: 'vpn-ketoan',
    allowedIps: '0.0.0.0/0',
    note: 'ghi chú cũ',
  };
  const patch = (over: Partial<ServiceAccountPatch> = {}): ServiceAccountPatch => ({
    code: 'VPN-KETOAN',
    kind: 'vpn',
    name: 'VPN kế toán',
    ...over,
  });

  const cases: {
    name: string;
    input: ServiceAccountPatch;
    before?: ServiceAccountStored | null;
    field: ServiceAccountOptionalField;
    expected: string | null;
  }[] = [
    // 1. Ô KHÔNG gửi = đừng đụng tới.
    { name: 'sửa: ô không gửi giữ giá trị cũ', input: patch(), before: stored, field: 'login', expected: 'ketoan@pmh.com.vn' },
    { name: 'sửa: dải IP không gửi vẫn là dải cũ', input: patch(), before: stored, field: 'allowedIps', expected: '0.0.0.0/0' },
    // 2. Gửi chuỗi rỗng = xoá thật, vì người dùng xoá trắng ô là có ý.
    { name: 'sửa: gửi rỗng thì xoá', input: patch({ login: '' }), before: stored, field: 'login', expected: null },
    { name: 'sửa: gửi toàn khoảng trắng cũng là xoá', input: patch({ note: '   ' }), before: stored, field: 'note', expected: null },
    // 3. Gửi giá trị mới thì đè, và cắt khoảng trắng thừa.
    { name: 'sửa: giá trị mới đè lên cũ', input: patch({ department: '  Kỹ thuật  ' }), before: stored, field: 'department', expected: 'Kỹ thuật' },
    // 4. TẠO MỚI thì thiếu ô đúng là để trống — không có `before` để lấp.
    { name: 'tạo: ô không gửi là null', input: patch(), before: undefined, field: 'ownerName', expected: null },
    { name: 'tạo: ô có gửi thì giữ', input: patch({ ownerName: 'Anh Hùng' }), before: null, field: 'ownerName', expected: 'Anh Hùng' },
    /*
     * 5. Ô của loại KHÁC không được lấp bằng giá trị cũ. Đổi VPN → dùng chung mà không gửi lại
     *    `groupName`: lấp bằng giá trị cũ là báo lỗi "dùng chung không có nhóm VPN" cho một ô
     *    người dùng vừa cố tình bỏ đi.
     */
    { name: 'đổi sang dùng chung: nhóm VPN cũ KHÔNG theo sang', input: patch({ kind: 'shared' }), before: stored, field: 'groupName', expected: null },
    { name: 'đổi sang dùng chung: dải IP cũ KHÔNG theo sang', input: patch({ kind: 'shared' }), before: stored, field: 'allowedIps', expected: null },
    // …nhưng ô mà body THẬT SỰ gửi lên thì vẫn phải thấy, để còn báo là gõ nhầm loại.
    { name: 'dùng chung mà vẫn gửi nhóm VPN: giữ để báo lỗi', input: patch({ kind: 'shared', groupName: 'vpn-lo' }), before: null, field: 'groupName', expected: 'vpn-lo' },
  ];

  for (const { name, input, before, field, expected } of cases) {
    it(`${name} → ${field} = ${expected === null ? 'null' : `"${expected}"`}`, () => {
      expect(mergeServiceAccount(input, before)[field]).toBe(expected);
    });
  }

  /*
   * Đây là lý do cả hàm này tồn tại: kiểm luật phải chạy trên bản ĐÃ GHÉP.
   *
   * `PATCH {code, kind, name}` lên một tài khoản VPN đang mở `0.0.0.0/0` mà kiểm trên body thì
   * `warnings` rỗng — đọc thành "kiểm rồi, sạch" cho một dòng vẫn mở toang cho cả internet.
   */
  it('cảnh báo dải IP quá rộng vẫn còn khi PATCH không gửi lại dải IP', () => {
    // `patch()` luôn có đủ code/name nên ép kiểu ở đây là an toàn — `ServiceAccountPatch` để
    // chúng tùy chọn chỉ vì đường TẠO MỚI có thể suy chúng ra sau (`fillBlanks`).
    const onBody = validateServiceAccount(patch() as ServiceAccountDraft);
    expect(onBody.warnings).toEqual([]);

    const onMerged = validateServiceAccount(mergeServiceAccount(patch(), stored));
    expect(onMerged.errors).toEqual([]);
    expect(onMerged.warnings).toHaveLength(1);
    expect(onMerged.warnings[0]).toContain('0.0.0.0/0');
  });

  it('đổi loại sang dùng chung KHÔNG bị báo lỗi vì hai ô VPN cũ', () => {
    const result = validateServiceAccount(mergeServiceAccount(patch({ kind: 'shared' }), stored));
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});

/**
 * Người khai biết tài khoản đăng nhập bằng gì; "mã tài khoản" là thứ hệ thống cần chứ họ
 * không cần. Bắt gõ là bắt bịa — và mỗi người bịa một kiểu, đúng thứ làm cột mã vô dụng.
 */
describe('codeFromLogin — suy mã từ tên đăng nhập', () => {
  const cases: { login: string; expected: string }[] = [
    { login: 'ketoan@pmh.com.vn', expected: 'KETOAN' },
    { login: 'vpn-ketoan', expected: 'VPN-KETOAN' },
    // Dấu chấm, gạch dưới, khoảng trắng đều thành MỘT gạch nối — không đẻ ra "A--B".
    { login: 'ke.toan_2@pmh.com.vn', expected: 'KE-TOAN-2' },
    { login: '  admin  ', expected: 'ADMIN' },
    { login: 'Nguyễn Văn A', expected: 'NGUYEN-VAN-A' },
    { login: 'đăng-nhập', expected: 'DANG-NHAP' },
    // Gạch nối thừa ở hai đầu bị cắt: "-admin-@x" ra "ADMIN", không phải "-ADMIN-".
    { login: '-admin-@pmh.com.vn', expected: 'ADMIN' },
    // Không còn ký tự nào dùng được thì phải có một gốc để còn thêm số vào.
    { login: '@@@', expected: 'TK' },
    { login: '', expected: 'TK' },
  ];

  for (const { login, expected } of cases) {
    it(`"${login}" → ${expected}`, () => {
      expect(codeFromLogin(login)).toBe(expected);
    });
  }
});

import { addDays } from '../../common/today';
import {
  autoRetireOn,
  effectiveSoftwareStatus,
  normalizeWebsites,
  requiresEndDate,
  seatConflicts,
  STATUS_LABEL,
  supportsSeats,
  supportsWebsites,
  validateAssignmentTerms,
  validateSoftware,
  type AssignmentTerms,
  type LicenseModel,
  type SoftwareEffective,
  type SoftwareKind,
} from './software-rules';

function effective(over: Partial<SoftwareEffective> = {}): SoftwareEffective {
  return {
    kind: 'license',
    licenseModel: 'subscription',
    seatTotal: null,
    startDate: null,
    endDate: '2027-12-31',
    ...over,
  };
}

describe('requiresEndDate — loại nào bắt buộc có hạn', () => {
  it.each([
    ['license', 'subscription', true],
    ['ssl', 'subscription', true],
    ['domain', 'subscription', true],
    ['maintenance', 'subscription', false],
    ['other', 'subscription', false],
    // License MUA ĐỨT không có ngày hết hạn để mà nhắc — bắt buộc nhập là ép người dùng
    // bịa một ngày, rồi tới ngày đó hệ thống đi nhắc gia hạn một thứ không cần gia hạn.
    ['license', 'perpetual', false],
  ])('%s + %s → %s', (kind, model, expected) => {
    expect(requiresEndDate(kind as SoftwareKind, model as LicenseModel)).toBe(expected);
  });
});

describe('license vĩnh viễn', () => {
  it('không cần ngày hết hạn', () => {
    expect(
      validateSoftware(effective({ licenseModel: 'perpetual', endDate: null })),
    ).toEqual([]);
  });

  it('chỉ cần ngày bắt đầu là đủ', () => {
    expect(
      validateSoftware(
        effective({ licenseModel: 'perpetual', endDate: null, startDate: '2026-01-01' }),
      ),
    ).toEqual([]);
  });

  /** Vừa "vĩnh viễn" vừa có ngày hết hạn là hai lời khẳng định ngược nhau — chặn từ đầu. */
  it('có ngày hết hạn thì bị từ chối, nói rõ mâu thuẫn', () => {
    const errors = validateSoftware(
      effective({ licenseModel: 'perpetual', endDate: '2027-01-01' }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('vĩnh viễn');
  });

  /** Chỉ license mới có chuyện mua đứt; SSL/tên miền luôn có kỳ hạn. */
  it.each(['ssl', 'domain'])('%s đánh dấu vĩnh viễn thì bị từ chối', (kind) => {
    const errors = validateSoftware(
      effective({ kind: kind as SoftwareKind, licenseModel: 'perpetual', endDate: null }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('supportsSeats — chỉ license mới có seat', () => {
  it.each([
    ['license', true],
    ['ssl', false],
    ['domain', false],
    ['maintenance', false],
    ['other', false],
  ])('%s → %s', (kind, expected) => {
    expect(supportsSeats(kind as SoftwareKind)).toBe(expected);
  });
});

describe('validateAssignmentTerms — kỳ hạn & chi phí RIÊNG của từng ghế', () => {
  function terms(over: Partial<AssignmentTerms> = {}): AssignmentTerms {
    return { cost: null, contract: null, startDate: null, endDate: null, ...over };
  }

  it('ghế không khai gì cả là hợp lệ — mọi trường đều tùy chọn', () => {
    expect(validateAssignmentTerms(terms())).toEqual([]);
  });

  it('khai đủ chi phí, hợp đồng và kỳ hạn = hợp lệ', () => {
    expect(
      validateAssignmentTerms(
        terms({
          cost: 3_500_000,
          contract: 'HD-2026-014',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ),
    ).toEqual([]);
  });

  /** Chi phí là TIỀN ĐỒNG: VND không có phần lẻ, và âm thì không phải chi phí. */
  it.each([[-1], [-3_000_000], [1.5], [0.01]])('chi phí %s là vô nghĩa → lỗi', (cost) => {
    const errors = validateAssignmentTerms(terms({ cost }));
    expect(errors.some((e) => e.includes('số nguyên'))).toBe(true);
  });

  it('chi phí 0 là hợp lệ — license được tặng kèm máy vẫn phải ghi nhận', () => {
    expect(validateAssignmentTerms(terms({ cost: 0 }))).toEqual([]);
  });

  /**
   * Cột `cost` là bigint; quá 2^53 thì JavaScript đọc ra một con số KHÁC lúc ghi vào mà
   * không có lỗi nào. Chặn ở đây để tiền không lặng lẽ sai chữ số cuối.
   */
  it('chi phí vượt ngưỡng số nguyên an toàn → lỗi, không lặng lẽ làm tròn', () => {
    const errors = validateAssignmentTerms(terms({ cost: Number.MAX_SAFE_INTEGER + 2 }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ngày kết thúc trước ngày bắt đầu = lỗi', () => {
    const errors = validateAssignmentTerms(
      terms({ startDate: '2026-06-01', endDate: '2026-01-01' }),
    );
    expect(errors.some((e) => e.includes('sau ngày bắt đầu'))).toBe(true);
  });

  it('cùng ngày bắt đầu và kết thúc là hợp lệ — thuê một ngày vẫn là kỳ hạn thật', () => {
    expect(
      validateAssignmentTerms(terms({ startDate: '2026-06-01', endDate: '2026-06-01' })),
    ).toEqual([]);
  });

  it('chỉ có ngày bắt đầu, chưa biết ngày kết thúc = hợp lệ', () => {
    expect(validateAssignmentTerms(terms({ startDate: '2026-06-01' }))).toEqual([]);
  });

  /**
   * License mua đứt mà ghế lại có ngày kết thúc là hai lời khẳng định ngược nhau — y hệt
   * luật ở tầng hồ sơ, chỉ khác chỗ đặt. Cho lọt thì cỗ máy nhắc hạn sẽ đi giục gia hạn
   * một chỗ ngồi vĩnh viễn.
   */
  it('license mua đứt: ghế có ngày kết thúc thì bị từ chối', () => {
    const errors = validateAssignmentTerms(terms({ endDate: '2027-01-01' }), 'perpetual');
    expect(errors.some((e) => e.includes('vĩnh viễn'))).toBe(true);
  });

  it('license mua đứt: ghế chỉ có ngày bắt đầu là hợp lệ', () => {
    expect(
      validateAssignmentTerms(terms({ startDate: '2026-01-01' }), 'perpetual'),
    ).toEqual([]);
  });

  it('gom HẾT lỗi trong một lần, không dừng ở lỗi đầu', () => {
    const errors = validateAssignmentTerms(
      terms({ cost: -1, startDate: '2026-06-01', endDate: '2026-01-01' }),
    );
    expect(errors).toHaveLength(2);
  });
});

describe('validateSoftware', () => {
  it('license đủ hạn = hợp lệ', () => {
    expect(validateSoftware(effective())).toEqual([]);
  });

  it.each([['license'], ['ssl'], ['domain']])(
    '%s thiếu ngày hết hạn = lỗi, nói rõ vì sao cần',
    (kind) => {
      const errors = validateSoftware(
        effective({ kind: kind as SoftwareKind, endDate: null }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('nhắc gia hạn');
    },
  );

  it.each([['maintenance'], ['other']])('%s không cần hạn', (kind) => {
    expect(
      validateSoftware(effective({ kind: kind as SoftwareKind, endDate: null })),
    ).toEqual([]);
  });

  it('ngày hết hạn trước ngày bắt đầu = lỗi', () => {
    const errors = validateSoftware(
      effective({ startDate: '2027-01-01', endDate: '2026-01-01' }),
    );
    expect(errors).toContain('Ngày hết hạn phải sau ngày bắt đầu.');
  });

  it('seat trên loại không phải license = lỗi, chỉ rõ nên để trống', () => {
    const errors = validateSoftware(effective({ kind: 'ssl', seatTotal: 5 }));
    expect(errors.some((e) => e.includes('để trống'))).toBe(true);
  });

  it.each([[0], [-3], [1.5]])('seat = %s là vô nghĩa → lỗi', (seat) => {
    const errors = validateSoftware(effective({ seatTotal: seat }));
    expect(errors.some((e) => e.includes('số nguyên'))).toBe(true);
  });

  it('gom HẾT lỗi của một hồ sơ trong một lần, không dừng ở lỗi đầu', () => {
    const errors = validateSoftware({
      kind: 'ssl',
      licenseModel: 'subscription',
      seatTotal: 5,
      startDate: '2027-01-01',
      endDate: null,
    });
    // Thiếu hạn + seat trên loại không hỗ trợ = 2 lỗi cùng lúc.
    expect(errors).toHaveLength(2);
  });
});

describe('effectiveSoftwareStatus — DOM-03: hạn quyết trạng thái, người chỉ quyết Thanh lý', () => {
  const TODAY = '2026-10-01';
  it.each([
    // [trạng thái đang lưu, ngày hết hạn, → trạng thái hiệu lực]
    ['active', '2026-10-01', 'active'], // hết hạn HÔM NAY vẫn còn dùng được trọn ngày
    ['active', '2026-09-30', 'expired_ok'], // qua ngày hết hạn → hệ thống tự chuyển
    ['expired_ok', '2027-01-01', 'active'], // nhập ngày mới → tự về Đang dùng
    ['expired_ok', '2026-09-01', 'expired_ok'],
    ['active', null, 'active'], // vĩnh viễn: không bao giờ hết hạn
    ['expired_ok', null, 'active'],
    ['retired', '2020-01-01', 'retired'], // Thanh lý là quyết định của người, hạn không đổi được nó
    ['retired', '2030-01-01', 'retired'],
  ] as const)('%s + hạn %s → %s', (status, endDate, expected) => {
    expect(effectiveSoftwareStatus(status, endDate, TODAY)).toBe(expected);
  });
});

/**
 * BE-09 — sửa hồ sơ không được bỏ rơi ghế đang gán: đổi loại, chuyển vĩnh viễn khi ghế còn
 * hạn, hạ tổng seat dưới số đang dùng, hay thanh lý khi còn máy dùng đều để lại những dòng
 * gán mà luật của chính hồ sơ không còn nhận.
 */
describe('seatConflicts — sửa hồ sơ khi đang có ghế gán', () => {
  const lic = { kind: 'license', licenseModel: 'subscription', seatTotal: 10, status: 'active' } as const;
  const busy = { used: 4, withEndDate: 2 };

  it.each([
    ['không đổi gì', lic, busy, 0],
    ['đổi sang SSL khi còn ghế', { ...lic, kind: 'ssl' }, busy, 1],
    ['đổi loại khi KHÔNG còn ghế', { ...lic, kind: 'ssl' }, { used: 0, withEndDate: 0 }, 0],
    ['vĩnh viễn khi 2 ghế còn hạn', { ...lic, licenseModel: 'perpetual' }, busy, 1],
    ['vĩnh viễn khi ghế không hạn', { ...lic, licenseModel: 'perpetual' }, { used: 4, withEndDate: 0 }, 0],
    ['hạ seat xuống 3 khi dùng 4', { ...lic, seatTotal: 3 }, busy, 1],
    ['hạ seat xuống đúng 4', { ...lic, seatTotal: 4 }, busy, 0],
    ['bỏ trần seat', { ...lic, seatTotal: null }, busy, 0],
    ['thanh lý khi còn ghế — không chặn, service tự gỡ ghế (Q-03)', { ...lic, status: 'retired' }, busy, 0],
    ['thanh lý khi hết ghế', { ...lic, status: 'retired' }, { used: 0, withEndDate: 0 }, 0],
    // Vượt trần có lý do (gán kèm overSeatReason) rồi thanh lý: mọi ghế sắp bị gỡ, không còn gì để "hạ trần".
    ['thanh lý license đang vượt ghế 2/1', { ...lic, seatTotal: 1, status: 'retired' }, { used: 2, withEndDate: 0 }, 0],
    ['thanh lý kèm đổi sang vĩnh viễn khi ghế còn hạn', { ...lic, licenseModel: 'perpetual', status: 'retired' }, busy, 0],
  ] as const)('%s → %i lỗi', (_name, next, seats, count) => {
    const errors = seatConflicts(next, seats);
    expect(errors).toHaveLength(count);
    for (const error of errors) expect(error).toMatch(/ghế/);
  });
});

/**
 * Vượt ghế là trạng thái HỢP LỆ (gán vượt phải ghi lý do). Luật "không hạ tổng dưới số đang dùng"
 * chỉ chặn khi lượt sửa ĐỔI tổng ghế — sửa ghi chú của một license 2/1 không được bị 409.
 */
describe('seatConflicts — license đang vượt ghế', () => {
  const over = { kind: 'license', licenseModel: 'subscription', seatTotal: 1, status: 'active' } as const;
  const seats = { used: 2, withEndDate: 0 };
  it.each([
    ['tổng không đổi (chỉ sửa ghi chú)', over, 1, 0],
    ['đặt trần 1 cho license đang không giới hạn', { ...over, seatTotal: 1 }, null, 1],
    ['hạ tổng thêm nữa', { ...over, seatTotal: 0 }, 1, 1],
    ['nâng tổng đủ số đang dùng', { ...over, seatTotal: 2 }, 1, 0],
  ] as const)('%s → %i lỗi', (_name, next, beforeSeatTotal, count) => {
    expect(seatConflicts(next, seats, beforeSeatTotal)).toHaveLength(count);
  });
});

/**
 * Q-13 — ngày lượt quét sẽ tự Thanh lý. Phải khớp đúng điều kiện SQL của `syncExpiryStatuses`
 * (`end_date < today - grace`): màn hình đếm ngược tới ngày này, lệch một ngày là màn hứa sai.
 */
describe('autoRetireOn — ngày hệ thống sẽ tự thanh lý', () => {
  it.each([
    ['Hết hạn, ân hạn 30', 'expired_ok', '2026-09-01', 30, '2026-10-02'],
    ['Hết hạn, ân hạn 1', 'expired_ok', '2026-09-01', 1, '2026-09-03'],
    ['ân hạn 0 = tắt tự thanh lý', 'expired_ok', '2026-09-01', 0, null],
    ['Đang dùng thì chưa có ngày', 'active', '2026-09-01', 30, null],
    ['Đã thanh lý thì thôi', 'retired', '2026-09-01', 30, null],
    ['không có hạn', 'expired_ok', null, 30, null],
  ] as const)('%s', (_name, status, endDate, grace, expected) => {
    expect(autoRetireOn(status, endDate, grace)).toBe(expected);
  });

  it('khớp điều kiện của lượt quét: ngày trước đó chưa thanh lý, đúng ngày đó thì thanh lý', () => {
    const end = '2026-09-01';
    const on = autoRetireOn('expired_ok', end, 30)!;
    const sweepRetires = (today: string) => end < addDays(today, -30);
    expect(sweepRetires(addDays(on, -1))).toBe(false);
    expect(sweepRetires(on)).toBe(true);
  });
});

describe('normalizeWebsites — website dùng chứng chỉ SSL / tên miền (Q-15, SW-043)', () => {
  it.each([
    ['bỏ dòng trống, cắt khoảng trắng', [' shop.pmh.vn ', '', '   '], ['shop.pmh.vn']],
    ['bỏ giao thức và dấu / cuối — người ta dán URL', ['https://Shop.PMH.vn/', 'http://mail.pmh.vn//'], ['shop.pmh.vn', 'mail.pmh.vn']],
    ['trùng (không phân biệt hoa thường) chỉ giữ một, theo thứ tự nhập', ['b.pmh.vn', 'a.pmh.vn', 'B.PMH.VN'], ['b.pmh.vn', 'a.pmh.vn']],
    ['giữ đường dẫn sau tên máy', ['pmh.vn/shop'], ['pmh.vn/shop']],
    ['wildcard hợp lệ', ['*.pmh.vn'], ['*.pmh.vn']],
  ])('%s', (_label, input, expected) => {
    expect(normalizeWebsites(input)).toEqual({ value: expected, errors: [] });
  });

  it('khoảng trắng giữa chừng = hai website dán chung một dòng → lỗi nêu đúng dòng', () => {
    const { errors } = normalizeWebsites(['shop.pmh.vn mail.pmh.vn']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('shop.pmh.vn mail.pmh.vn');
  });

  it('quá dài / quá nhiều dòng → lỗi, không lặng lẽ cắt', () => {
    expect(normalizeWebsites([`${'a'.repeat(254)}.vn`]).errors).toHaveLength(1);
    const many = Array.from({ length: 201 }, (_v, i) => `w${i}.pmh.vn`);
    expect(normalizeWebsites(many).errors).toHaveLength(1);
  });

  it('chỉ SSL và tên miền có danh sách website', () => {
    expect(supportsWebsites('ssl')).toBe(true);
    expect(supportsWebsites('domain')).toBe(true);
    expect(supportsWebsites('license')).toBe(false);
    expect(supportsWebsites('maintenance')).toBe(false);
  });
});

describe('STATUS_LABEL — nhãn trạng thái trong file Excel (Q-14)', () => {
  it('trạng thái cuối là "Đã thanh lý", không phải nhãn nút "Thanh lý"', () => {
    expect(STATUS_LABEL.retired).toBe('Đã thanh lý');
  });
});

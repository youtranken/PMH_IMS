import {
  requiresEndDate,
  supportsSeats,
  validateSoftware,
  type SoftwareEffective,
  type SoftwareKind,
} from './software-rules';

function effective(over: Partial<SoftwareEffective> = {}): SoftwareEffective {
  return {
    kind: 'license',
    seatTotal: null,
    startDate: null,
    endDate: '2027-12-31',
    ...over,
  };
}

describe('requiresEndDate — loại nào bắt buộc có hạn', () => {
  it.each([
    ['license', true],
    ['ssl', true],
    ['domain', true],
    ['maintenance', false],
    ['other', false],
  ])('%s → %s', (kind, expected) => {
    expect(requiresEndDate(kind as SoftwareKind)).toBe(expected);
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
      seatTotal: 5,
      startDate: '2027-01-01',
      endDate: null,
    });
    // Thiếu hạn + seat trên loại không hỗ trợ = 2 lỗi cùng lúc.
    expect(errors).toHaveLength(2);
  });
});

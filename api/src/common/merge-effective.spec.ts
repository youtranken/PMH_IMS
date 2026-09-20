import { effectiveOf, effectiveValue } from './merge-effective';

/**
 * Bảng dữ liệu cho phép ghép — hàm thuần, không qua HTTP (CLAUDE.md).
 *
 * Cột `??` ghi lại kết quả của bản CŨ để bảng tự nói ra chỗ khác nhau: chỉ đúng một hàng
 * lệch, và đó là hàng sinh ra A-03.
 */
describe('effectiveValue — ba trạng thái của một ô, không phải hai', () => {
  const OLD = '2027-01-31';

  const cases: {
    name: string;
    values: Record<string, unknown>;
    expected: string | null;
    nullishResult: string | null;
  }[] = [
    {
      name: 'không đụng tới ô → giữ giá trị đang có',
      values: {},
      expected: OLD,
      nullishResult: OLD,
    },
    {
      name: 'đặt giá trị mới → lấy giá trị mới',
      values: { endDate: '2028-06-30' },
      expected: '2028-06-30',
      nullishResult: '2028-06-30',
    },
    {
      name: 'XOÁ ô (null) → phải là null, đây là hàng mà `??` trả sai',
      values: { endDate: null },
      expected: null,
      nullishResult: OLD,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(effectiveValue<string | null>(c.values, 'endDate', OLD)).toBe(c.expected);
      // Bản cũ, viết lại nguyên văn để bảng trên là bằng chứng chứ không phải lời kể.
      const nullish = ((c.values as { endDate?: string | null }).endDate ?? OLD) as string | null;
      expect(nullish).toBe(c.nullishResult);
    });
  }

  it('phân biệt được khoá có mặt mang giá trị falsy khác null', () => {
    expect(effectiveValue<number | null>({ seatTotal: 0 }, 'seatTotal', 10)).toBe(0);
    expect(effectiveValue<string | null>({ note: '' }, 'note', 'cũ')).toBe('');
  });

  it('không nhầm khoá kế thừa từ prototype với khoá của chính túi values', () => {
    // `in` đi lên chuỗi prototype, nên một túi dựng bằng object literal vẫn "có" `toString`.
    // Trường ghép luôn là tên cột thật, nhưng chốt này khoá lại hình dạng đang dựa vào.
    expect(effectiveValue<string>({}, 'endDate', 'dự phòng')).toBe('dự phòng');
    expect(Object.prototype.hasOwnProperty.call({}, 'endDate')).toBe(false);
  });

  it('effectiveOf buộc sẵn túi values và cho kết quả y hệt', () => {
    const values = { startDate: null, endDate: '2028-06-30' };
    const effective = effectiveOf(values);
    expect(effective<string | null>('startDate', '2026-01-01')).toBeNull();
    expect(effective<string | null>('endDate', '2026-12-31')).toBe('2028-06-30');
    expect(effective<string | null>('note', 'giữ nguyên')).toBe('giữ nguyên');
  });
});

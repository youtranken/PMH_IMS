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
    /*
     * KHOÁ CÓ MẶT NHƯNG MANG `undefined` → vẫn là "không đụng tới ô".
     *
     * Hàng này sinh ra ngày 21/09 từ một bài E2E đỏ, không phải từ suy nghĩ ở bàn giấy.
     * `nat-rule.service` truyền thẳng object mà controller dựng — object ĐỦ KHOÁ, khoá nào
     * người dùng không gửi thì mang `undefined`. Với `field in values` thì mọi khoá đều "có
     * mặt", nên `effective` trả `undefined` cho cả mười ô và bản sửa nào cũng bị coi là xoá
     * sạch mọi thứ. Ba nơi đợt B sửa không dính vì `values` ở đó do `put()` dựng, mà `put()`
     * bỏ qua `undefined` — tức hàm này đang sống nhờ một hợp đồng NGẦM của nơi gọi.
     *
     * JSON không có `undefined`. "Có khoá, giá trị `undefined`" và "không có khoá" là cùng
     * một ý định; chỉ `null` mới là ý định XOÁ. Hàm phải tự đứng vững, đừng bắt nơi gọi nhớ.
     */
    {
      name: 'khoá có mặt nhưng mang `undefined` → vẫn là không đụng tới ô',
      values: { endDate: undefined },
      expected: OLD,
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
    /*
     * BẢN ĐẦU CỦA BÀI NÀY KHÔNG THỂ ĐỎ — sửa 21/09 sau lượt rà soát chéo.
     *
     * Nó khẳng định `effectiveValue({}, 'endDate', …)` trả giá trị dự phòng. Nhưng
     * `'endDate' in {}` là `false` với CẢ `in` lẫn `hasOwnProperty`, nên câu đó xanh với mọi
     * cách viết — một bài kiểm mang tên một rủi ro mà nó không hề chạm tới. Dự án này có
     * kỷ luật "gieo đột biến mới tính là bài kiểm"; bài cũ không sống nổi qua chính kỷ luật
     * ấy, vì không tồn tại đột biến nào làm nó đỏ.
     *
     * Ca THẬT là một khoá CÓ trên prototype: `'toString' in {}` là `true`.
     */
    expect('toString' in {}).toBe(true); // tiền đề — nếu câu này sai thì bài dưới vô nghĩa
    expect(effectiveValue<string>({}, 'toString', 'dự phòng')).toBe('dự phòng');
    expect(effectiveValue<string>({}, 'constructor', 'dự phòng')).toBe('dự phòng');
  });

  it('effectiveOf buộc sẵn túi values và cho kết quả y hệt', () => {
    const values = { startDate: null, endDate: '2028-06-30' };
    const effective = effectiveOf(values);
    expect(effective<string | null>('startDate', '2026-01-01')).toBeNull();
    expect(effective<string | null>('endDate', '2026-12-31')).toBe('2028-06-30');
    expect(effective<string | null>('note', 'giữ nguyên')).toBe('giữ nguyên');
  });
});

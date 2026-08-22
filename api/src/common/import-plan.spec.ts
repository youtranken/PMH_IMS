import {
  cellText,
  isExampleRow,
  normalizeHeader,
  normalizeKey,
  parseBoolean,
  parseDateCell,
  pickCell,
  stripDiacritics,
  summarize,
} from './import-plan';

describe('normalizeHeader — khớp tiêu đề cột dù người dùng gõ khác đi', () => {
  it.each([
    ['Mã site *', 'mã site'],
    ['  TÊN   SITE  ', 'tên site'],
    ['Có port map?', 'có port map?'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });
});

describe('stripDiacritics — chỉ để so nhãn, không dùng cho dữ liệu', () => {
  it.each([
    ['Mã site', 'Ma site'],
    ['Điện thoại', 'Dien thoai'],
    ['ĐỖ', 'DO'],
  ])('%s → %s', (input, expected) => {
    expect(stripDiacritics(input)).toBe(expected);
  });
});

describe('pickCell — lấy ô theo tên cột, chấp nhận có dấu lẫn không dấu', () => {
  const cells = { 'Mã thiết bị *': 'SW-01', 'Ghi chú': 'nội dung' };

  it('khớp tên cột có dấu', () => {
    expect(pickCell(cells, ['mã thiết bị'])).toBe('SW-01');
  });

  it('khớp cả khi alias viết không dấu', () => {
    expect(pickCell(cells, ['ma thiet bi'])).toBe('SW-01');
  });

  it('không có cột thì trả undefined (khác hẳn ô trống)', () => {
    expect(pickCell(cells, ['serial'])).toBeUndefined();
  });
});

describe('parseDateCell — nhận cả cách gõ ngày của người Việt', () => {
  it.each([
    ['2026-08-30', '2026-08-30'],
    ['30/08/2026', '2026-08-30'],
    ['1/9/2026', '2026-09-01'],
    ['30-8-2026', '2026-08-30'],
    ['2026-8-9', '2026-08-09'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateCell(input)).toEqual({ ok: true, value: expected });
  });

  it.each([['ô rỗng', ''], ['toàn khoảng trắng', '   '], ['không có cột', undefined]])(
    '%s → đọc được, giá trị null (không phải lỗi)',
    (_label, input) => {
      expect(parseDateCell(input)).toEqual({ ok: true, value: null });
    },
  );

  it.each([
    ['ngày mai'],
    ['31/02/2026'],
    ['2026-13-01'],
    ['30/8/26'],
  ])('"%s" → không đọc được, báo lỗi chứ không đoán bừa', (input) => {
    expect(parseDateCell(input)).toEqual({ ok: false });
  });
});

describe('parseBoolean', () => {
  it.each([
    ['Có', true],
    ['CO', true],
    ['x', true],
    ['1', true],
    ['Không', false],
    ['', false],
    ['no', false],
  ])('"%s" → %s', (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });
});

describe('isExampleRow — dòng VÍ DỤ trong file mẫu bị bỏ qua', () => {
  it.each([
    [{ 'Ghi chú nhập': 'VÍ DỤ' }, true],
    [{ 'Ghi chú nhập': 'ví dụ' }, true],
    [{ 'Ghi chu nhap': 'VI DU' }, true],
    [{ 'Ghi chú nhập': '' }, false],
    [{ 'Ghi chú': 'VÍ DỤ' }, false],
  ])('%o → %s', (cells, expected) => {
    expect(isExampleRow(cells)).toBe(expected);
  });
});

describe('normalizeKey / cellText / summarize', () => {
  it('khóa đối chiếu bỏ qua hoa-thường và khoảng trắng thừa', () => {
    expect(normalizeKey('  PMH-HO  ')).toBe('pmh-ho');
    expect(normalizeKey('Dell   Partner VN')).toBe('dell partner vn');
  });

  it('cellText đưa undefined về chuỗi rỗng', () => {
    expect(cellText(undefined)).toBe('');
    expect(cellText('  x  ')).toBe('x');
  });

  it('summarize đếm đúng từng loại kết quả', () => {
    expect(
      summarize([
        { action: 'create' },
        { action: 'create' },
        { action: 'error' },
        { action: 'skip' },
      ]),
    ).toEqual({ create: 2, update: 0, unchanged: 0, skip: 1, error: 1 });
  });
});

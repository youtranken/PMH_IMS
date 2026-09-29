import { RealDateOrEmpty } from '../../common/real-date';

/**
 * Ngày sinh (0031) — regex khuôn `YYYY-MM-DD` KHÔNG đủ.
 *
 * `2026-13-45` khớp khuôn, đi thẳng vào cột `date`, và Postgres ném 22008 → 500 trắng thay
 * vì câu tiếng Việt mà DTO viết ra để nói. Đây là loại lỗi chỉ lộ ra ở tầng DB, nên khoá nó
 * lại bằng test thuần ở đây.
 */
describe('RealDateOrEmpty — ngày sinh phải là ngày CÓ THẬT', () => {
  const validator = new RealDateOrEmpty();

  const ok = [
    '',
    '1990-05-20',
    '2000-02-29', // năm nhuận
    '1999-12-31',
    '2026-01-01',
  ];
  for (const value of ok) {
    it(`nhận "${value || '(rỗng = xoá ngày sinh)'}"`, () => {
      expect(validator.validate(value)).toBe(true);
    });
  }

  const bad = [
    '2026-13-45', // đúng khuôn nhưng tháng 13, ngày 45
    '2026-02-30', // tháng 2 không có ngày 30
    '2001-02-29', // 2001 không nhuận
    '2026-00-10',
    '2026-01-00',
    '26-01-01',
    '2026/01/01',
    'hôm qua',
  ];
  for (const value of bad) {
    it(`từ chối "${value}"`, () => {
      expect(validator.validate(value)).toBe(false);
    });
  }

  it('giá trị không phải chuỗi thì từ chối — nhiều DTO chỉ có mỗi validator này trên ô ngày', () => {
    expect(validator.validate(12345)).toBe(false);
    expect(validator.validate(null)).toBe(false);
  });
});

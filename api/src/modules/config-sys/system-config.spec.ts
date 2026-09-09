import { parseConfigNumber } from './system-config.parse';

/**
 * `getNumber` — chuỗi RỖNG không được thành số 0.
 *
 * ===== VÌ SAO MỘT Ô TRỐNG LÀ SỰ CỐ TOÀN CÔNG TY =====
 *
 * `Number('')` trong JavaScript là `0`, và `Number.isFinite(0)` là `true`. Nên bản trước:
 *
 *     const value = typeof raw === 'number' ? raw : Number(raw);
 *     if (!Number.isFinite(value)) return fallback;   // KHÔNG bao giờ chạy với ''
 *
 * cho ra `0` — im lặng, không một dòng cảnh báo. Với `session.absolute_hours` thì `0` nghĩa là
 * "phiên hết hạn ngay lập tức": ai đăng nhập cũng bị đá ra tức thì, cả công ty không vào được
 * hệ thống, và nhật ký không có gì bất thường để lần ra. Với `login.max_failed_attempts` thì
 * `0` nghĩa là khóa tài khoản ngay từ lần gõ sai đầu tiên.
 *
 * Admin xóa nội dung một ô trên màn Tham số rồi bấm Lưu là đủ để tạo ra chuyện đó. Rà soát
 * 07/09, mục 6 "Nghiệp vụ".
 *
 * Tách hàm thuần ra file riêng để kiểm bằng BẢNG DỮ LIỆU, không phải dựng Nest và DB
 * (CLAUDE.md: logic thuần phải có test bảng, không test qua HTTP).
 */
describe('parseConfigNumber — chỉ nhận số THẬT, mọi thứ khác rơi về mặc định', () => {
  const FALLBACK = 12;

  it.each([
    ['số nguyên', 8, 8],
    ['số 0 VIẾT RÕ RÀNG vẫn là 0 hợp lệ', 0, 0],
    ['chuỗi số', '8', 8],
    ['chuỗi số có khoảng trắng thừa', ' 8 ', 8],
    ['số âm — hợp lệ về KIỂU, ràng buộc miền là việc của nơi gọi', -3, -3],
  ])('%s: %p → %p', (_name, raw, expected) => {
    expect(parseConfigNumber(raw, FALLBACK)).toEqual({ value: expected, fellBack: false });
  });

  it.each([
    ['chuỗi rỗng — CHÍNH LÀ LỖI ĐÃ VÁ', ''],
    ['chỉ khoảng trắng', '   '],
    ['null', null],
    ['undefined', undefined],
    ['chữ', 'mười hai'],
    ['số kèm chữ', '12 giờ'],
    ['NaN', Number.NaN],
    ['vô cực', Number.POSITIVE_INFINITY],
    ['object', { hours: 12 }],
    ['mảng rỗng — `Number([])` cũng là 0, cùng lớp bẫy với chuỗi rỗng', []],
    ['boolean — `Number(true)` là 1, không phải cấu hình ai định viết', true],
  ])('%s: %p → rơi về mặc định VÀ báo là đã rơi', (_name, raw) => {
    expect(parseConfigNumber(raw, FALLBACK)).toEqual({ value: FALLBACK, fellBack: true });
  });

  /**
   * `fellBack` tồn tại để nơi gọi CÓ THỂ kêu lên. Trả mỗi con số thì cấu hình hỏng và cấu
   * hình đúng-bằng-mặc-định trông giống hệt nhau — đúng cái làm lỗi cũ vô hình suốt.
   */
  it('phân biệt được "đúng bằng mặc định" với "hỏng nên rơi về mặc định"', () => {
    expect(parseConfigNumber(12, FALLBACK)).toEqual({ value: 12, fellBack: false });
    expect(parseConfigNumber('', FALLBACK)).toEqual({ value: 12, fellBack: true });
  });
});

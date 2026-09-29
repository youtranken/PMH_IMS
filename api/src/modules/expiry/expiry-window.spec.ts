import { clampWindow } from './expiry.service';

/**
 * CỬA SỔ "SẮP HẾT HẠN" — bài kiểm bảng dữ liệu cho một hàm thuần.
 *
 * ===== ĐÂY LÀ BÀI GHI LẠI HÀNH VI, KHÔNG PHẢI BẰNG CHỨNG CỦA MỘT BẢN VÁ =====
 *
 * Nói thẳng để không ai đọc nhầm: `clampWindow` KHÔNG hỏng. Chỗ sửa của A-08 nằm ở
 * `dashboard.service.ts` chứ không ở đây.
 *
 * Bài này canh lời hứa "mặc định là `expiry.warning_days`, không phải 30 viết cứng" — viết
 * ngay trên đầu hàm này. Không có nó thì cả hai đầu của lời hứa đều không ai canh: nơi gọi
 * ghi đè cấu hình mà không gì đỏ, và ai đó đổi `fallback` thành một hằng số cũng chẳng gì đỏ.
 *
 * Một lời hứa viết trong chú thích mà không có bài kiểm thì nó là một ý định, không phải một
 * bảo đảm — A-08 chính là một chú thích "cùng con số với màn Expiry" bị code bỏ quên.
 *
 * CLAUDE.md: logic thuần phải có bài kiểm bảng dữ liệu, không kiểm qua HTTP.
 */

/** Ngưỡng "vàng" đọc từ `system_config` — con số thật, không phải 30 viết cứng. */
const WARNING_DAYS_FROM_CONFIG = 60;

describe('clampWindow — cửa sổ nhìn tới của màn "Sắp hết hạn"', () => {
  it.each([
    // [người dùng gửi gì, kết quả, vì sao]
    [undefined, WARNING_DAYS_FROM_CONFIG, 'không chọn ⇒ theo `expiry.warning_days` (AD-11)'],
    [Number.NaN, WARNING_DAYS_FROM_CONFIG, '`?withinDays=abc` ⇒ cũng về mặc định, không NaN'],
    [45, 45, 'người dùng tự chọn thì nghe lời'],
    [1, 1, 'biên dưới'],
    [365, 365, 'biên trên'],
    [0, 1, '0 sẽ trả rỗng và người đọc tưởng không có gì sắp hết hạn'],
    [-5, 1, 'số âm cũng kéo về biên dưới'],
    [99_999, 365, 'kéo cả kho ra thì màn chết — kẹp lại'],
    [45.9, 45, 'cắt phần thập phân, không làm tròn lên'],
  ])('withinDays=%p → %p (%s)', (value, expected) => {
    expect(clampWindow(value, WARNING_DAYS_FROM_CONFIG)).toBe(expected);
  });

  it('mặc định đi theo CẤU HÌNH, không phải một hằng số nào trong mã', () => {
    // Hai ngưỡng khác nhau phải ra hai cửa sổ khác nhau. Nếu có ai thay `fallback` bằng một
    // con số viết cứng thì đúng ca này đỏ.
    expect(clampWindow(undefined, 30)).toBe(30);
    expect(clampWindow(undefined, 90)).toBe(90);
  });
});

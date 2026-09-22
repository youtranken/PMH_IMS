import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../test/source-text';

/**
 * NÚT TRONG EMAIL PHẢI DẪN TỚI MỘT MÀN CÓ THẬT (B-08 / T-02).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Hai lá thư CẢNH BÁO BẢO MẬT — "Một tài khoản đang bị dò mật khẩu" và "Có người đang dò dẫm
 * quanh két sắt" — cùng đặt một nút **"Xem nhật ký đăng nhập"** trỏ tới `/quan-tri/nhat-ky`.
 *
 * Đường đó CÓ trong `LEGACY_ROUTES` nên nó chuyển hướng đúng sang `/admin/audit-log`. Nhưng
 * `/admin/audit-log` KHÔNG có `<Route>` nào trong `App.tsx` — màn nhật ký chưa bao giờ được
 * dựng. Chuyển hướng chạy đúng, tới một đường không tồn tại, rồi rơi vào `<Route path="*">`.
 *
 * Tức là **404**.
 *
 * Khác hẳn B-07, nơi đích tới có thật và chỉ đi vòng qua một lớp tương thích. Ở đây đích tới
 * là hư không.
 *
 * ===== VÌ SAO NÓ ĐAU HƠN VẺ NGOÀI =====
 *
 * Đây là thư cảnh báo bảo mật — loại người ta mở đúng lúc đang lo. Bấm vào, nhận trang trắng
 * "Không tìm thấy". Hai lần như thế là họ thôi bấm, kể cả lá thư thật sự khẩn sau này. Một
 * cái nút hỏng trong thư khẩn không chỉ vô dụng: nó bào mòn lòng tin vào cả kênh cảnh báo.
 *
 * Và câu `footnote` ngay dưới còn dặn "Mở nhật ký xem các lượt sai đến từ một nơi hay nhiều
 * nơi" — một lời khuyên KHÔNG LÀM THEO ĐƯỢC. Nên bỏ nút thôi chưa đủ; phải sửa cả lời khuyên
 * sang việc người nhận làm được ngay hôm nay.
 *
 * ===== CÁCH HỎI =====
 *
 * Bài này đọc nguồn thay vì gửi thư thật: câu hỏi là "mã có dựng nút trỏ tới màn chưa tồn tại
 * không", và đó là câu về MÃ. Vế "thư gửi đi có đúng hình dạng không" đã do
 * `e2e/tests/expiry-digest.spec.ts` và `api/test/mail-transport.spec.ts` giữ.
 */

const CONSUMER = join(__dirname, 'mail.consumer.ts');
const APP_TSX = join(__dirname, '..', '..', '..', '..', 'web', 'src', 'App.tsx');

/** Mọi `ctaUrl:` trong consumer, đã lột chú thích. */
function ctaUrls(): string[] {
  const source = stripComments(readFileSync(CONSUMER, 'utf8'));
  return [...source.matchAll(/ctaUrl:\s*([^\n]+)/g)].map((m) => m[1].trim());
}

describe('CTA trong email', () => {
  it('có đọc được `ctaUrl` (vế đối chứng cho chính bài này)', () => {
    // Đổi tên trường mà bài này im lặng thì nó thôi canh gì cả.
    expect(ctaUrls().length).toBeGreaterThan(0);
  });

  it('không nút nào trỏ tới màn nhật ký — màn đó chưa dựng', () => {
    const guilty = ctaUrls().filter((url) => url.includes('nhat-ky') || url.includes('audit-log'));
    expect(guilty).toEqual([]);
  });

  /**
   * Và giữ cho lời khẳng định trên còn ĐÚNG: ngày nào màn nhật ký được dựng thật thì bài này
   * phải ĐỎ, để người dựng nó nhớ trả lại cái nút cho hai lá thư.
   *
   * Không có vế này thì "đừng trỏ tới nhật ký" trở thành một luật vĩnh viễn, và hai lá thư
   * mất nút mãi mãi vì một lý do đã hết hiệu lực.
   */
  it('nếu màn nhật ký ĐÃ được dựng thì phải trả nút lại — bài này đỏ để nhắc', () => {
    const app = stripComments(readFileSync(APP_TSX, 'utf8'));
    const built = /path=\{PATHS\.adminAuditLog\}/.test(app);
    expect(
      built,
      // Jest không nhận tham số thứ hai; lý do nằm ở chú thích trên.
    ).toBe(false);
  });

  it('mọi `ctaUrl` còn lại đều ghép từ `UI_PATHS` hoặc là trang chủ', () => {
    // Sau B-07, đường dẫn trong api chỉ được lấy từ `UI_PATHS`. Một chuỗi gõ tay lọt vào đây
    // là bản sao thứ ba của cùng một sự thật — đúng thứ vừa dọn.
    const handGrafted = ctaUrls().filter(
      (url) => !url.includes('UI_PATHS') && !/^APP_URL\(\),?$/.test(url),
    );
    expect(handGrafted).toEqual([]);
  });
});

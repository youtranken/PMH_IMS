import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../test/source-text';

/**
 * NÚT TRONG EMAIL PHẢI DẪN TỚI MỘT MÀN CÓ THẬT.
 *
 * React Router trả trang 404 rất bình thản, và không ai bấm thử link trong một email test —
 * nên một nút trỏ vào đường chưa có `<Route>` sống được rất lâu. Với thư cảnh báo bảo mật thì
 * cái giá cao hơn: người ta mở nó đúng lúc đang lo, bấm vào gặp 404 vài lần là thôi tin cả
 * kênh cảnh báo.
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

  /**
   * Hai thư cảnh báo (đoán mật khẩu, dò két) trỏ tới màn Nhật ký lọc sẵn theo người bị nghi.
   * Vế `App.tsx` giữ cho lời mời ấy còn đúng: gỡ `<Route>` của màn mà quên gỡ nút là đỏ.
   */
  it('nút nhật ký trỏ tới màn có `<Route>` thật', () => {
    const auditCtas = ctaUrls().filter((url) => url.includes('UI_PATHS.auditLog('));
    expect(auditCtas).toHaveLength(2);

    const app = stripComments(readFileSync(APP_TSX, 'utf8'));
    expect(app).toMatch(/path=\{PATHS\.adminAuditLog\}/);
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

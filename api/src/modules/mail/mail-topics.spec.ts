import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../test/source-text';
import { HANDLED_MAIL_TOPICS } from './mail.consumer';

/**
 * "KHÔNG CÓ MẪU THƯ" VÀ "KHÔNG CÒN GÌ ĐỂ GỬI" LÀ HAI CHUYỆN (B-06).
 *
 * `build()` trả `null` cho cả hai, và bản trước ghi CÙNG MỘT dòng `warn`:
 *
 *   1. Không có mẫu thư cho topic này — ai đó đẩy một topic consumer chưa từng biết. Đây là
 *      LỖI: một sự kiện nghiệp vụ vừa xảy ra và sẽ không ai được báo, vĩnh viễn.
 *   2. Có mẫu nhưng không còn gì để gửi — hồ sơ đã xoá, phiếu đã quyết, hết người nhận. Đây
 *      là chuyện BÌNH THƯỜNG, xảy ra hằng ngày.
 *
 * Gộp hai thứ vào một mức log thì lỗi thật nằm lẫn giữa hàng trăm dòng vô hại. Không ai lọc
 * ra được, và người đọc log quen mắt tới mức thôi đọc — đó mới là cái mất lớn nhất.
 *
 * ===== BÀI NÀY CANH CÁI DANH SÁCH, VÌ DANH SÁCH LÀ CHỖ SẼ LỆCH =====
 *
 * `HANDLED_MAIL_TOPICS` gõ tay, còn sự thật nằm ở các `case` trong `build()`. Hai nơi thì sẽ
 * trôi — đúng mẫu mà F-09 vừa chứng minh. Nên bài đối chiếu cả hai chiều, và còn hỏi thêm một
 * câu thứ ba mà không nơi nào khác hỏi: **mọi topic được ĐẨY vào outbox có mẫu thư chưa?**
 */

const CONSUMER = join(__dirname, 'mail.consumer.ts');
const API_SRC = join(__dirname, '..', '..');

/**
 * Mọi topic mà `build()` THẬT SỰ nhận — đây mới là sự thật.
 *
 * Hai lối viết, và bản đầu của bài này chỉ tìm một: phần lớn topic đi qua `case '...'` của
 * `switch`, nhưng ba topic (`expiry.digest`, `approval.requested`, `approval.reminder`) được
 * xử bằng `if (topic === '...')` TRƯỚC `switch`, vì chúng không gắn với một `user` nào.
 *
 * Chỉ quét `case` thì ba topic ấy trông như "khai thừa trong danh sách" — bài đỏ oan, và
 * người sửa sẽ đi xoá chúng khỏi `HANDLED_MAIL_TOPICS`, tức phá đúng thứ bài này canh.
 */
function casesInBuild(): string[] {
  const source = stripComments(readFileSync(CONSUMER, 'utf8'));
  const fromSwitch = [...source.matchAll(/case '([a-z0-9.]+)':/g)].map((m) => m[1]);
  const fromIf = [...source.matchAll(/topic === '([a-z0-9.]+)'/g)].map((m) => m[1]);
  return [...new Set([...fromSwitch, ...fromIf])];
}

/** Mọi topic được đẩy vào outbox trong toàn bộ api. */
function enqueuedTopics(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) files.push(full);
    }
  };
  walk(API_SRC);
  const found = new Set<string>();
  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const m of source.matchAll(/enqueueWithin\(\s*tx,\s*'([a-z0-9.]+)'/g)) found.add(m[1]);
  }
  return [...found];
}

describe('Danh sách topic có mẫu thư', () => {
  it('đọc được các `case` trong build (vế đối chứng cho chính bài này)', () => {
    expect(casesInBuild().length).toBeGreaterThan(5);
  });

  it('mọi `case` trong `build()` đều có trong `HANDLED_MAIL_TOPICS`', () => {
    const missing = casesInBuild().filter((topic) => !HANDLED_MAIL_TOPICS.has(topic));
    expect(missing).toEqual([]);
  });

  it('và ngược lại — không khai một topic mà `build()` không xử', () => {
    // Một dòng thừa trong danh sách nghĩa là một topic sẽ ÂM THẦM rơi vào nhánh "bình thường"
    // trong khi thật ra nó không có mẫu. Sai đúng theo chiều nguy hiểm.
    const cases = new Set(casesInBuild());
    expect([...HANDLED_MAIL_TOPICS].filter((topic) => !cases.has(topic))).toEqual([]);
  });

  /**
   * CÂU HỎI THỨ BA, VÀ NÓ LÀ CÂU ĐÁNG GIÁ NHẤT.
   *
   * Hai bài trên giữ hai danh sách khớp nhau. Bài này hỏi thứ khác hẳn: có ai ĐẨY một topic
   * vào outbox mà không có mẫu thư không? Đó chính là ca số 1 — sự kiện xảy ra, không ai được
   * báo — và trước hôm nay không cổng nào hỏi được câu ấy.
   */
  it('mọi topic được đẩy vào outbox đều có mẫu thư', () => {
    const orphans = enqueuedTopics().filter((topic) => !HANDLED_MAIL_TOPICS.has(topic));
    expect(orphans).toEqual([]);
  });
});

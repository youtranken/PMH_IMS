import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mọi controller nghiệp vụ phải khai tiền tố `api/v1`.
 *
 * VÌ SAO: `web/nginx.conf` chỉ chuyển tiếp `location /api/`, `location = /api` và
 * `location = /health` sang backend. Mọi đường khác rơi vào `location /` — tức SPA fallback,
 * trả về `index.html`. Một controller quên tiền tố thì endpoint của nó KHÔNG TỒN TẠI với
 * trình duyệt: không lỗi biên dịch, không lỗi khởi động, Nest vẫn đăng ký route bình thường,
 * chỉ là không ai gọi tới được.
 *
 * Chuyện đã xảy ra thật: `AuditController` khai `@Controller('admin/audit')` và sống 9 epic
 * — controller duy nhất trong 17 cái thiếu tiền tố. Phát hiện ngày 03/09 khi E2E lần đầu
 * chạm tới endpoint đó và nhận 404. Xem `docs/CODE-REVIEW-2026-08-28.md`.
 *
 * Bài này quét file nguồn thay vì dựng app, nên nó chạy trong mili-giây và không cần DB.
 */

const MODULES_DIR = join(__dirname, 'modules');

/** Ngoại lệ khai TƯỜNG MINH — nginx có `location = /health` riêng cho đúng đường này. */
const ALLOWED_WITHOUT_PREFIX = new Map<string, string>([
  ['health/health.controller.ts', 'health'],
]);

function findControllers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findControllers(full, acc);
    else if (entry.endsWith('.controller.ts')) acc.push(full);
  }
  return acc;
}

describe('AD-2 — tiền tố đường dẫn của controller', () => {
  const files = findControllers(MODULES_DIR);

  it('tìm thấy đủ controller để bài kiểm có ý nghĩa', () => {
    // Chốt sàn: nếu ai đó đổi cấu trúc thư mục làm hàm quét trả về rỗng, bài này đỏ thay vì
    // im lặng "xanh vì không tìm thấy gì" — đúng lỗi đã giết luật eslint AD-2 (xem
    // src/ad2-boundary.spec.ts). Hiện có 17 controller nghiệp vụ.
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('modules')).replace(/\\/g, '/'), f]))(
    '%s khai tiền tố api/v1',
    (_label, file) => {
      const source = readFileSync(file, 'utf8');
      // Neo vào ĐẦU DÒNG: decorator của class nằm ở cột 0, còn chú thích thì luôn thụt vào
      // (` * ...`). Không neo thì regex khớp nhầm vào chính đoạn chú thích kể lại sự cố.
      const match = /^@Controller\(\s*['"`]([^'"`]*)['"`]/m.exec(source);
      // Phải có `@Controller` với đường dẫn dạng chuỗi.
      expect(match).not.toBeNull();

      // So sánh chính chuỗi route để thông điệp lỗi nói ra nó đang là gì.
      const route = match![1];
      expect(`${route} (phải bắt đầu bằng api/v1/)`).toMatch(/^api\/v1\//);
    },
  );

  it('danh sách ngoại lệ vẫn khớp thực tế (không có mục chết)', () => {
    for (const [relative, expected] of ALLOWED_WITHOUT_PREFIX) {
      const source = readFileSync(join(__dirname, relative), 'utf8');
      // Neo vào ĐẦU DÒNG: decorator của class nằm ở cột 0, còn chú thích thì luôn thụt vào
      // (` * ...`). Không neo thì regex khớp nhầm vào chính đoạn chú thích kể lại sự cố.
      const match = /^@Controller\(\s*['"`]([^'"`]*)['"`]/m.exec(source);
      expect(match![1]).toBe(expected);
    }
  });
});

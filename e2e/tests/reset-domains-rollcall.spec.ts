import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * HAI DANH SÁCH VÙNG DỌN PHẢI NÓI CÙNG MỘT THỨ.
 *
 * ===== VÌ SAO =====
 *
 * `api/scripts/reset-e2e.mjs` khai `DOMAINS` — tên vùng và các câu SQL của nó. `helpers.ts`
 * khai `DOMAIN_ORDER` — danh sách mà `flushResets()` truyền cho script. Hai mảng ở hai repo
 * con, không có gì buộc chúng khớp nhau.
 *
 * Lệch một tên thì hỏng im lặng theo đúng hướng tệ nhất: `queueReset('digest-rules')` gọi một
 * vùng script không biết → script thoát với mã 1 → `dockerExec` ném → bài kiểm đỏ ở
 * `beforeEach`, tức đỏ TRƯỚC khi chạm vào thứ nó định kiểm. Người đọc log sẽ đi tìm ở nhầm
 * chỗ hoàn toàn.
 *
 * Và `catalog` PHẢI đứng cuối ở cả hai: nó là thứ mọi vùng khác trỏ vào (site · tủ · nhà cung
 * cấp · loại thiết bị · cổng dịch vụ · phòng ban · nhà mạng), nên dọn nó trước là lỗi khoá
 * ngoại. Từ 18/09 script tự sắp lại theo thứ tự khai của chính nó nên thứ tự tham số không
 * còn quyết định gì — nhưng bất biến "catalog cuối" thì vẫn là bất biến, và đây là nơi nói ra.
 *
 * Bài này đọc VĂN BẢN chứ không `import`: `reset-e2e.mjs` là script Node chạy TRONG container
 * api, nạp nó vào Playwright là kéo theo `pg` và một `DATABASE_URL` không tồn tại ở đây.
 */
/* ESM: `__dirname` không tồn tại — cùng lối với `di-khap-giao-dien.spec.ts`. */
const DAY = dirname(fileURLToPath(import.meta.url));
const GOC = join(DAY, '..', '..');

function vungCuaScript(): string[] {
  const src = readFileSync(join(GOC, 'api', 'scripts', 'reset-e2e.mjs'), 'utf8');
  const khoi = /const DOMAINS = \{([\s\S]*?)\n\};/.exec(src);
  expect(khoi, 'không tìm thấy khối DOMAINS trong reset-e2e.mjs').not.toBeNull();
  /*
   * NỚI REGEX, RỒI CHỐT SÀN (19/09/2026).
   *
   * Bản trước ghim CẢ mức thụt lề (`^ {2}`) LẪN bộ ký tự (`[a-z-]`), nên nó giòn hai chiều:
   *   · prettier hay ai đó đổi sang 4 dấu cách → danh sách rỗng → bài đỏ với thông báo trỏ
   *     sai chỗ hoàn toàn ("thiếu vùng X") thay vì "không đọc được file";
   *   · thêm một vùng có chữ số hoặc chữ hoa (`nat2`, `ipamV6`) → regex bỏ qua → bài 2 XANH
   *     dù vùng ấy chưa ai gọi tới, và rác của nó sống sót qua mọi `beforeEach`.
   *
   * `\[` ở cuối để không dính khoá lồng bên trong mỗi vùng. Chốt sàn bên dưới bắt cảnh "đọc
   * ra rỗng" phải đỏ như một lỗi đọc file, không giả dạng thành lỗi thiếu vùng.
   */
  const ten = [...khoi![1].matchAll(/^\s{1,4}'?([A-Za-z0-9-]+)'?:\s*\[/gm)].map((m) => m[1]);
  expect(
    ten.length,
    'đọc ra quá ít vùng từ DOMAINS — regex hỏng chứ không phải script thiếu vùng',
  ).toBeGreaterThanOrEqual(10);
  return ten;
}

function vungCuaHelpers(): string[] {
  const src = readFileSync(join(DAY, 'helpers.ts'), 'utf8');
  const khoi = /const DOMAIN_ORDER = \[([\s\S]*?)\] as const;/.exec(src);
  expect(khoi, 'không tìm thấy DOMAIN_ORDER trong helpers.ts').not.toBeNull();
  return [...khoi![1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

test.describe('Sổ vùng dọn tự canh chính nó', () => {
  test('mọi vùng `helpers.ts` gọi đều CÓ THẬT trong reset-e2e.mjs', () => {
    const script = vungCuaScript();
    /* `users` CÓ nằm trong `DOMAINS` (là khoá đầu) — chú thích cũ ở đây nói ngược, sửa
       19/09/2026. Giữ nó trong tập hợp lệ vì banner của script vẫn liệt kê nó riêng, và vì
       `flushResets()` gọi tên đó trực tiếp. */
    const hopLe = new Set(['users', ...script]);
    const thua = vungCuaHelpers().filter((v) => !hopLe.has(v));
    expect(thua, 'vùng chỉ có ở helpers.ts — script sẽ thoát mã 1 ngay ở beforeEach').toEqual([]);
  });

  test('mọi vùng script biết dọn đều được `helpers.ts` gọi tới', () => {
    const goiDuoc = new Set(vungCuaHelpers());
    const bỏQuen = vungCuaScript().filter((v) => !goiDuoc.has(v));
    expect(
      bỏQuen,
      'vùng script dọn được nhưng không bài nào gọi — rác của vùng đó sống sót qua mọi beforeEach',
    ).toEqual([]);
  });

  test('`catalog` đứng CUỐI ở cả hai danh sách', () => {
    const script = vungCuaScript();
    const helpers = vungCuaHelpers();
    expect(script[script.length - 1], 'catalog phải là vùng cuối của reset-e2e.mjs').toBe(
      'catalog',
    );
    expect(helpers[helpers.length - 1], 'catalog phải là vùng cuối của DOMAIN_ORDER').toBe(
      'catalog',
    );
  });
});

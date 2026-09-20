import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tiện ích cho những bài kiểm ĐỌC MÃ NGUỒN DẠNG VĂN BẢN.
 *
 * ===== VÌ SAO TỒN TẠI =====
 *
 * Vài hàng rào trong repo này không thể chứng minh bằng cách CHẠY: "dòng gác không được biến
 * mất", "khóa phải đứng trước câu đếm", "mọi route phải khai vai". Chúng được canh bằng cách
 * đọc chính file nguồn rồi so chuỗi. Cách ấy có đúng một cái bẫy, và repo đã dính hai lần:
 *
 *   · `vault-surface.spec.ts` (19/09/2026) khẳng định `body` chứa `'assertCanReveal'`, nhưng
 *     trong lát cắt ấy có một dòng CHÚ THÍCH nhắc tên hàm — nên khẳng định được thỏa bởi chú
 *     thích, không phải bởi hàng rào. Gỡ trắng break-glass: 9/9 vẫn xanh.
 *   · `test/subnet-cidr-race.spec.ts` (phát hiện 19/09, vá 20/09) tìm `'FOR UPDATE'` trong
 *     thân `update()`. Chuỗi ấy xuất hiện LẦN ĐẦU ở `subnet.service.ts:253` — **bên trong một
 *     block comment** — còn câu SQL thật ở dòng 257. Xóa hẳn dòng 257 mà giữ chú thích thì cả
 *     4 khẳng định vẫn xanh, và 3 bài đua phía trên cũng xanh.
 *
 * Chú thích trong repo này viết rất kỹ, nên chúng gần như luôn nhắc đúng cái tên mà bài kiểm
 * đang tìm. **Bài kiểm càng viết chú thích cẩn thận thì càng dễ tự thỏa mãn chính mình.**
 *
 * ===== VÌ SAO LÀ MỘT BẢN DÙNG CHUNG =====
 *
 * Trước lượt này, cùng một cặp `.replace()` được chép **4 lần trong riêng
 * `vault-surface.spec.ts`**, và bài thứ năm (`subnet-cidr-race`) thì quên hẳn. Đó đúng là hình
 * dạng mà AD-15 cấm: một luật, nhiều bản, và bản quên là bản để lọt. Nay một nơi, nhiều nơi gọi.
 *
 * Đặt ở `src/test/` theo đúng tiền lệ `web/src/test/quet-nguon.ts`. Cả hai tầng Jest đều với
 * tới được: `jest.config.js` (`rootDir: src`, `testRegex: .*\.spec\.ts$`) KHÔNG nhặt file này
 * vì tên không mang `.spec.`, còn `test/jest-db.cjs` (`rootDir: ..`) import bằng đường dẫn
 * tương đối.
 */

/**
 * Bỏ mọi chú thích khỏi một lát mã nguồn, giữ nguyên phần còn lại.
 *
 * Xử lý cả block comment (kể cả nhiều dòng) lẫn `//` tới hết dòng.
 *
 * GIỚI HẠN PHẢI BIẾT: đây là phép thay chuỗi, không phải bộ phân tích cú pháp. Một chuỗi ký tự
 * chứa `//` bên trong nó cũng bị cắt. Với việc đang làm — tìm tên hàm, từ khóa SQL và decorator
 * trong thân một lớp — điều đó vô hại, và nó thiên về phía AN TOÀN: cắt nhầm chỉ có thể làm
 * bài kiểm ĐỎ, không bao giờ làm nó xanh sai. Cần chính xác hơn thì dùng AST, đừng nới hàm này.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/* ─────────────────────────── Quét controller ─────────────────────────── */

/** Mọi `*.controller.ts` dưới một thư mục, đệ quy. */
export function allControllers(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allControllers(full);
    return full.endsWith('.controller.ts') ? [full] : [];
  });
}

/**
 * Khối decorator NGAY TRÊN `@Controller(...)`.
 *
 * Không dùng `src.slice(0, indexOf('export class'))`: `accounts.controller.ts` có
 * `export class RealDateOrEmpty` (một ValidatorConstraint) ở đầu file, nên cách cắt đó dừng
 * lại trước cả phần cần đọc và báo thiếu cho một file KHÔNG thiếu. Bài kiểm sai theo hướng
 * đó còn tệ hơn không có bài kiểm: nó dạy người ta bỏ qua màu đỏ.
 *
 * ĐI CẢ HAI CHIỀU quanh `@Controller(...)` (sửa 20/09/2026). Bản trước chỉ đi LÊN, và nó chỉ
 * tình cờ đúng vì mọi controller đang đặt `@NoStepUp()` phía trên. `audit.controller.ts` đặt
 * `@Roles('sa','admin')` ở dòng NGAY DƯỚI `@Controller(...)`, nên bản cũ đọc hụt và báo hai
 * route của nó là thiếu vai — một dương-tính-giả, tức đúng loại bài kiểm dạy người ta bỏ qua
 * màu đỏ mà chú thích ngay trên đây lên án.
 */
export function classDecoratorsOf(src: string): string {
  const lines = src.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith('@Controller('));
  if (at < 0) return '';
  let from = at;
  while (from > 0 && (lines[from - 1].startsWith('@') || lines[from - 1].trim() === '')) from -= 1;
  let to = at;
  while (to + 1 < lines.length && lines[to + 1].startsWith('@')) to += 1;
  return lines.slice(from, to + 1).join('\n');
}

const HTTP_DECORATOR = /^@(Get|Post|Put|Patch|Delete)\(/;

export interface RouteBlock {
  /** Dòng decorator HTTP, ví dụ `@Post(':id/reveal')`. */
  route: string;
  /** Trọn khối decorator của route đó — từ sau member trước tới chính dòng HTTP. */
  decorators: string;
  /** Số dòng trong file (1-based), để thông báo lỗi chỉ được đúng chỗ. */
  line: number;
}

/**
 * Mọi route handler trong một controller, kèm TRỌN khối decorator của riêng nó.
 *
 * Đọc theo KHỐI chứ không `src.includes('@Roles(')` trên cả file: một route khai đủ không được
 * phép làm xanh hộ route bên cạnh — đúng loại khẳng định luôn-đúng mà `step-up-surface.spec.ts`
 * đã dựng ra để tránh.
 *
 * Ranh giới trên của khối là member trước đó (dòng chỉ có `}`) hoặc đầu lớp; nhờ vậy decorator
 * nhiều dòng (`@Throttle({ … })`) vẫn nằm trọn trong khối.
 */
export function routesOf(src: string): RouteBlock[] {
  /*
   * Cắt trên DÒNG GỐC, lột chú thích SAU (sửa 20/09/2026).
   *
   * Bản đầu chạy `stripComments(src)` rồi mới tách dòng. Hai hậu quả, cả hai đều làm bài kiểm
   * báo sai: (1) `.replace()` nuốt luôn xuống dòng của block comment nên `line` lệch so với
   * file thật — thông báo lỗi chỉ sai chỗ; (2) chỗ docblock biến mất để lại dòng trống, mà
   * dòng trống lại là ranh giới, nên khối decorator bị cắt cụt và 13 route KHÔNG thiếu bị báo
   * là thiếu. Dương-tính-giả ở một cổng bảo mật là thứ dạy người ta tắt cổng.
   */
  const lines = src.split(/\r?\n/);
  const out: RouteBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!HTTP_DECORATOR.test(lines[i].trim())) continue;
    let from = i;
    while (from > 0) {
      const prev = lines[from - 1].trim();
      // Ranh giới = hết thân member trước (`}`) hoặc dòng mở lớp (`… {`). Dòng trống và dòng
      // chú thích KHÔNG phải ranh giới: docblock hay nằm giữa `@Roles` và `@Get`.
      // `endsWith('}')` phủ cả thân method một dòng (`a() {}`), không chỉ dòng `}` đứng riêng.
      // Decorator không bao giờ kết thúc bằng `}` (chúng đóng bằng `)`), nên không cắt nhầm.
      if (prev.endsWith('}') || prev.endsWith('{')) break;
      from -= 1;
    }
    out.push({
      route: lines[i].trim(),
      // Lột chú thích ở ĐÂY: một docblock nhắc `@Roles(...)` không được làm xanh hộ route.
      decorators: stripComments(lines.slice(from, i + 1).join('\n')),
      line: i + 1,
    });
  }
  return out;
}

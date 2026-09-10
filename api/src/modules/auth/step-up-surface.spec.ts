import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function allControllers(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allControllers(full);
    return full.endsWith('.controller.ts') ? [full] : [];
  });
}

const CONTROLLERS = allControllers(SRC);

/**
 * Khối decorator NGAY TRÊN `@Controller(...)`.
 *
 * Không dùng `src.slice(0, indexOf('export class'))`: `accounts.controller.ts` có
 * `export class RealDateOrEmpty` (một ValidatorConstraint) ở đầu file, nên cách cắt đó dừng
 * lại trước cả phần cần đọc và báo thiếu cho một file KHÔNG thiếu. Bài kiểm sai theo hướng
 * đó còn tệ hơn không có bài kiểm: nó dạy người ta bỏ qua màu đỏ.
 */
function classDecoratorsOf(src: string): string {
  const lines = src.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith('@Controller('));
  if (at < 0) return '';
  let from = at;
  while (from > 0 && (lines[from - 1].startsWith('@') || lines[from - 1].trim() === '')) from -= 1;
  return lines.slice(from, at + 1).join('\n');
}

/**
 * CỔNG CANH CỔNG — `StepUpGuard` mặc định đóng chỉ có tác dụng nếu nó thật sự được cắm.
 *
 * ===== LỖ ĐANG ĐÓNG =====
 *
 * `@RequiresStepUp()` là opt-in, và tới 10/09 nó xuất hiện đúng 5 lần trong cả repo — tất cả ở
 * `vault.controller.ts`. Toàn bộ `/api/v1/accounts/*` đứng ngoài hàng rào suốt chín epic, và
 * không có gì đỏ để báo. Hậu quả không phải lý thuyết: một phiên SA bị chiếm (đúng mô hình đe
 * doạ mà cửa két tự nêu — "cookie trộm, máy bỏ ngỏ, chưa từng gõ mã") đi trọn được đường
 * `POST /accounts` (trả `temporaryPassword`) → đăng nhập → `POST /auth/totp/enroll` (trả secret
 * base32) → step-up → `POST /vault/secrets/:id/reveal`. Yếu tố thứ hai của NẠN NHÂN không bao
 * giờ được hỏi tới.
 *
 * ===== VÌ SAO BÀI KIỂM NÀY ĐỌC MÃ NGUỒN =====
 *
 * Cùng lý do với `vault-surface.spec.ts`: đây là luật nói về thứ PHẢI CÓ MẶT ở mọi nơi, và một
 * controller mới quên khai thì không request nào trong bộ test chạm tới nó để mà đỏ. Guard đã
 * chặn ở runtime (403 `STEP_UP_NOT_DECLARED`), nhưng lỗi đó chỉ hiện khi ai đó gọi đúng route
 * ấy — có thể là trên production. Bài này bắt ở tầng rẻ nhất, chạy trong mọi `npm test`.
 */
describe('Step-up mặc định đóng (FR-022)', () => {
  it('tìm được controller để mà kiểm — bài này vô nghĩa nếu danh sách rỗng', () => {
    expect(CONTROLLERS.length).toBeGreaterThan(10);
  });

  it('MỌI controller khai lập trường step-up ở cấp lớp', () => {
    const missing = CONTROLLERS.filter(
      (file) => !/@NoStepUp\(\)|@RequiresStepUp\(\)/.test(classDecoratorsOf(readFileSync(file, 'utf8'))),
    ).map((file) => file.slice(SRC.length + 1));

    expect(missing).toEqual([]);
  });

  /**
   * Guard phải được cắm TOÀN CỤC. Không có dòng này thì mọi `@RequiresStepUp()` trong repo trở
   * thành chú thích: metadata vẫn ở đó, không ai đọc.
   */
  it('StepUpGuard đăng ký là APP_GUARD trong app.module', () => {
    const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    expect(appModule).toMatch(/APP_GUARD,\s*useClass:\s*StepUpGuard/);
  });

  /**
   * KHOÁ HỒI QUY cho những cửa đã biết là nặng.
   *
   * Danh sách này không phải "tất cả những cửa cần step-up" — không ai suy ra được tập đó
   * bằng máy. Nó là tập những cửa mà việc GỠ step-up đi phải làm một bài kiểm đỏ, thay vì trôi
   * qua review. Thêm cửa nặng mới thì thêm dòng ở đây.
   */
  const LOCKED: { file: string; route: string; why: string }[] = [
    {
      file: 'modules/auth/accounts.controller.ts',
      route: "@Post()",
      why: 'tạo tài khoản — response trả thẳng temporaryPassword',
    },
    {
      file: 'modules/auth/accounts.controller.ts',
      route: "@Post(':id/reset-password')",
      why: 'trả temporaryPassword của người khác',
    },
    {
      file: 'modules/auth/accounts.controller.ts',
      route: "@Post(':id/reset-totp')",
      why: 'xoá yếu tố thứ hai của người khác',
    },
    {
      file: 'modules/auth/accounts.controller.ts',
      route: "@Patch(':id/totp-login-required')",
      why: 'tắt bắt buộc 2FA lúc đăng nhập',
    },
    {
      file: 'modules/auth/accounts.controller.ts',
      route: "@Patch(':id/status')",
      why: 'khoá/vô hiệu hoá tài khoản khác, kể cả SA',
    },
    {
      file: 'modules/vault/vault-access.controller.ts',
      route: '@Post()',
      why: 'cấp tầng quyền đọc két — cửa hậu BỀN, sống sau khi phiên chết',
    },
    {
      file: 'modules/vault/vault-access.controller.ts',
      route: "@Delete(':id')",
      why: 'gỡ quyền của đội trực',
    },
    {
      file: 'modules/vault/break-glass.controller.ts',
      route: "@Post(':id/approve')",
      why: 'cấp quyền đọc két nhiều giờ',
    },
    {
      file: 'modules/vault/break-glass.controller.ts',
      route: "@Post(':id/revoke')",
      why: 'thu hồi grant đang sống',
    },
    {
      file: 'modules/vault/vault.controller.ts',
      route: "@Post(':id/reveal')",
      why: 'đường DUY NHẤT plaintext rời khỏi hệ thống',
    },
  ];

  it.each(LOCKED)('$file $route đòi step-up ($why)', ({ file, route }) => {
    const src = readFileSync(join(SRC, ...file.split('/')), 'utf8');
    const at = src.indexOf(route);
    expect(at).toBeGreaterThan(-1);

    /*
     * Chỉ nhìn khối decorator NGAY TRÊN route, không nhìn cả file: `toContain` trên toàn file
     * sẽ xanh chỉ vì có một route KHÁC trong cùng file mang `@RequiresStepUp()` — đúng loại
     * khẳng định luôn đúng mà bài kiểm này sinh ra để tránh.
     */
    const prevRoute = Math.max(
      ...['@Get(', '@Post(', '@Patch(', '@Put(', '@Delete(']
        .map((m) => src.lastIndexOf(m, at - 1))
        .filter((i) => i >= 0),
      0,
    );
    expect(src.slice(prevRoute, at)).toContain('@RequiresStepUp()');
  });

  /**
   * VẾ ĐỐI CHỨNG. Không có nó thì một bản "gắn @RequiresStepUp() cho tất cả cho chắc" cũng
   * xanh hết — và bộ E2E sẽ chết vì mọi thao tác đều đòi mã 6 số, rồi hàng rào bị gỡ nguyên
   * cụm vào sáng hôm sau.
   */
  it('route đọc thông thường KHÔNG đòi step-up', () => {
    const devices = readFileSync(join(SRC, 'modules', 'devices', 'devices.controller.ts'), 'utf8');
    expect(classDecoratorsOf(devices)).toContain('@NoStepUp()');
    expect(devices).not.toContain('@RequiresStepUp()');
  });
});

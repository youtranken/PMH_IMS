import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allControllers, classDecoratorsOf, routesOf } from '../../test/source-text';

const SRC = join(__dirname, '..', '..');
const CONTROLLERS = allControllers(SRC);

/**
 * CỔNG CANH CỔNG — `RolesGuard` mặc định đóng chỉ có tác dụng nếu nó thật sự được cắm.
 *
 * ===== LỖ MÀ BÀI NÀY ĐÓNG =====
 *
 * `RolesGuard` ném `ROLES_NOT_DECLARED` cho route quên khai `@Roles` — nhưng đó là hàng rào
 * ở RUNTIME: lỗi chỉ hiện khi có người gọi đúng route ấy, và người đó có thể là người dùng
 * thật trên production. Guard anh em `StepUpGuard` có `step-up-surface.spec.ts` bắt việc quên
 * khai ở tầng rẻ nhất; `RolesGuard` thì không có gì tương đương.
 *
 * Bài này đóng khoảng trống đó: quét mọi `*.controller.ts` và đòi MỌI route handler được phủ
 * bởi `@Roles(...)` — ở cấp route hoặc cấp lớp — hoặc khai rõ `@Public()`.
 *
 * ===== VÌ SAO ĐỌC THEO KHỐI, KHÔNG `includes` CẢ FILE =====
 *
 * `src.includes('@Roles(')` sẽ XANH cho một controller có mười route mà chỉ một route khai.
 * `routesOf()` cắt đúng khối decorator của từng route, nên một route quên khai không được
 * hàng xóm che hộ. Cùng lý lẽ với chú thích ở `step-up-surface.spec.ts`.
 */
describe('Quyền mặc định đóng (AD-9) — mọi route phải khai vai', () => {
  it('tìm được controller để mà kiểm — bài này vô nghĩa nếu danh sách rỗng', () => {
    expect(CONTROLLERS.length).toBeGreaterThan(10);
  });

  it('đọc ra được route — bài này vô nghĩa nếu bộ quét trả về rỗng', () => {
    const total = CONTROLLERS.reduce(
      (sum, file) => sum + routesOf(readFileSync(file, 'utf8')).length,
      0,
    );
    // Repo có khoảng 90 route trên 18 controller. Chốt sàn rộng rãi để bài không đỏ vì
    // một lượt thêm/bớt route bình thường, nhưng vẫn đỏ nếu bộ quét hỏng và trả về gần rỗng.
    expect(total).toBeGreaterThan(50);
  });

  it('MỌI route handler được phủ bởi @Roles(...) hoặc khai rõ @Public()', () => {
    const missing: string[] = [];

    for (const file of CONTROLLERS) {
      const src = readFileSync(file, 'utf8');
      const classBlock = classDecoratorsOf(src);
      const classCovers = classBlock.includes('@Roles(') || classBlock.includes('@Public()');
      if (classCovers) continue;

      for (const route of routesOf(src)) {
        const covered = route.decorators.includes('@Roles(') || route.decorators.includes('@Public()');
        if (!covered) missing.push(`${file.slice(SRC.length + 1)}:${route.line} ${route.route}`);
      }
    }

    /*
     * Mảng rỗng chứ không `toHaveLength(0)`: khi đỏ, `toEqual([])` in ra ĐÚNG danh sách route
     * còn thiếu, còn `toHaveLength` chỉ in ra một con số và người đọc phải tự đi tìm.
     */
    expect(missing).toEqual([]);
  });

  /**
   * Guard phải được cắm TOÀN CỤC. Không có dòng này thì mọi `@Roles(...)` trong repo trở thành
   * chú thích: metadata vẫn ở đó, không ai đọc — và mặc-định-đóng biến thành mặc-định-MỞ.
   */
  it('RolesGuard đăng ký là APP_GUARD trong app.module', () => {
    const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    expect(appModule).toMatch(/APP_GUARD,\s*useClass:\s*RolesGuard/);
  });

  /**
   * Bộ quét phải TỰ chứng minh nó bắt được — nếu không, `missing` rỗng có thể chỉ vì
   * `routesOf` đọc hụt. Gieo một controller giả thiếu `@Roles` và đòi nó bị bắt.
   */
  it('bộ quét bắt được một route thiếu @Roles (tự kiểm chính nó)', () => {
    const fakeSource = [
      '@Controller("api/v1/gia")',
      'export class GiaController {',
      "  @Roles('sa')",
      '  @Get()',
      '  a() {}',
      '',
      "  @Post(':id')",
      '  b() {}',
      '}',
    ].join('\n');

    const routes = routesOf(fakeSource);
    expect(routes).toHaveLength(2);
    expect(routes[0].decorators).toContain('@Roles(');
    // Route thứ hai KHÔNG được thừa hưởng `@Roles` của route đứng trên nó.
    expect(routes[1].decorators).not.toContain('@Roles(');
  });
});

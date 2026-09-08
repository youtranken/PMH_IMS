import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VaultApiService } from './vault.api';

const SRC = join(__dirname, '..', '..');

function allTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allTsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/**
 * FR-026 — "không tồn tại endpoint/nút xuất toàn bộ secret ở MỌI quyền".
 *
 * Đây là loại luật không kiểm được bằng cách test một request: nó nói về thứ KHÔNG có mặt.
 * Nên kiểm bằng hình dạng của mặt tiền — nếu ai đó thêm route trần hay thêm hàm trả nhiều
 * plaintext, một trong các test dưới đây đỏ ngay, chứ không phải chờ review bắt được.
 */
describe('FR-026 — két sắt không có đường xuất hàng loạt', () => {
  const controller = readFileSync(join(__dirname, 'vault.controller.ts'), 'utf8');

  it('mọi route GET danh sách đều bắt buộc nói rõ chủ thể', () => {
    // `@Get()` trần chỉ hợp lệ khi tham số query là DTO có ownerType + ownerId bắt buộc.
    const listHandler = /@Get\(\)\s*\n\s*(?:async )?list\(([\s\S]*?)\) \{/.exec(controller);
    expect(listHandler).not.toBeNull();
    expect(listHandler![1]).toContain('OwnerQueryDto');

    const ownerDto = /class OwnerQueryDto \{([\s\S]*?)\n\}/.exec(controller)![1];
    // Không @IsOptional() nào trong DTO này — optional là mở đường liệt kê toàn bộ.
    expect(ownerDto).not.toContain('@IsOptional');
    expect(ownerDto).toContain('ownerType!');
    expect(ownerDto).toContain('ownerId!');
  });

  it('không có route xuất/tải hàng loạt', () => {
    for (const forbidden of ['export', 'download', 'xlsx', 'csv', 'all']) {
      expect(controller.toLowerCase()).not.toContain(`@get('${forbidden}`);
      expect(controller.toLowerCase()).not.toContain(`@post('${forbidden}`);
    }
  });

  /**
   * Đường mở két (4.2) là chỗ DUY NHẤT plaintext rời khỏi hệ thống. Ba thứ dưới đây mất
   * bất kỳ cái nào cũng không làm test nghiệp vụ nào đỏ, nên khóa chúng ở đây:
   * step-up (phiên bị chiếm vẫn không mở được), `no-store` (bấm Back ở máy dùng chung),
   * và MỘT id mỗi lần (không có dạng nhận mảng — đó là FR-026 đi cửa sau).
   */
  it('đường mở két có step-up, no-store, và mỗi lần đúng một secret', () => {
    const reveal = /@Roles[\s\S]*?@Post\(':id\/reveal'\)[\s\S]*?async reveal\(([\s\S]*?)\) \{/.exec(
      controller,
    );
    expect(reveal).not.toBeNull();

    const decorators = controller.slice(
      controller.lastIndexOf('@Roles', controller.indexOf("@Post(':id/reveal')")),
      controller.indexOf('async reveal('),
    );
    expect(decorators).toContain('@RequiresStepUp()');
    expect(decorators).toContain('StepUpGuard');
    expect(decorators).toContain("@Header('Cache-Control', 'no-store')");

    /**
     * Story 6.3 mở đường này cho Member — nhưng CHỈ khi thân hàm còn gọi `assertCanReveal`.
     *
     * Đây là thứ đáng khóa nhất của cả epic: bỏ `@Roles` đi là ai cũng thấy ngay, còn bỏ một
     * dòng `await this.breakGlass.assertCanReveal(...)` thì mọi test nghiệp vụ vẫn xanh và
     * mọi Member bỗng xem được mật khẩu của cả công ty. Không có gì đỏ để báo.
     */
    const body = controller.slice(
      controller.indexOf('async reveal('),
      controller.indexOf('/** "Xóa" = thu hồi mềm.'),
    );
    if (decorators.includes("'member'")) {
      expect(body).toContain('assertCanReveal');
      expect(body).toContain("role === 'member'");
    } else {
      expect(decorators).toContain("@Roles('sa', 'admin')");
    }

    // Tham số là IdParamDto (một id ở path), không phải body mang danh sách.
    expect(reveal![1]).toContain('IdParamDto');
    expect(reveal![1]).not.toContain('Body');
  });

  /**
   * api công khai của module là thứ các module khác gọi được. Khóa danh sách hàm ở đây lại:
   * thêm hàm mới phải sửa test này, tức là phải có người nhìn xem nó có trả bí mật không.
   */
  /**
   * Metadata mở cho Member (story 6.3) nhưng vẫn phải qua kiểm tầng — chủ thể ngoài quyền là
   * 403, không phải một danh sách rỗng lặng lẽ.
   */
  it('đường đọc metadata của Member có kiểm tầng', () => {
    const body = controller.slice(
      controller.indexOf('async list('),
      controller.indexOf("@Get('verdict')"),
    );
    expect(body).toContain('assertCanSeeMetadata');
  });

  /**
   * Trang tổng `/vault/owners` (26/08/2026) là NGOẠI LỆ DUY NHẤT được liệt kê qua nhiều chủ
   * thể — và nó chỉ được phép nói "máy nào có két, mấy ngăn", không được nói trong đó có gì.
   *
   * Khóa ranh giới ấy ở đây vì nó rất dễ trôi: một hôm ai đó thấy "hiện luôn tên ngăn cho
   * tiện" là bản đồ bí mật của công ty ra đời, mà không test nghiệp vụ nào đỏ.
   */
  describe('trang tổng chủ thể — liệt kê CHỦ THỂ, không liệt kê secret', () => {
    const ownersService = readFileSync(join(__dirname, 'vault-owners.service.ts'), 'utf8');
    const ownersController = readFileSync(join(__dirname, 'vault-owners.controller.ts'), 'utf8');

    it('không đụng tới nhãn, loại hay giá trị của secret', () => {
      // Bóc chú thích trước: bản thân đoạn giải thích ở đầu file có viết "không `label`,
      // không `kind`" — soi cả chú thích thì test đỏ vì đúng câu nói rằng nó không làm.
      const code = ownersService
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const forbidden of ['label', 'kind', 'value', 'plaintext', 'reveal', 'listFor']) {
        // Jest (khác Vitest) không nhận tham số thứ hai của `expect` — gắn tên vào chính
        // vòng lặp thì thông điệp lỗi vẫn chỉ đúng từ nào vi phạm.
        expect({ forbidden, hit: code.includes(forbidden) }).toEqual({ forbidden, hit: false });
      }
    });

    it('kiểu trả về không có trường nào mô tả nội dung két', () => {
      const shape = /export interface VaultOwnerSummary \{([\s\S]*?)\n\}/.exec(ownersService)![1];
      const fields = [...shape.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]).sort();
      expect(fields).toEqual([
        'code',
        'lastChangeAt',
        'name',
        'orphan',
        'ownerId',
        'ownerType',
        'secretCount',
        'siteCode',
      ]);
    });

    it('chỉ SA/Admin, và không có route xuất', () => {
      expect(ownersController).toContain("@Roles('sa', 'admin')");
      for (const forbidden of ['export', 'download', 'xlsx', 'csv']) {
        expect(ownersController.toLowerCase()).not.toContain(`@get('${forbidden}`);
      }
    });
  });

  /**
   * Danh sách này là DÂY BẪY, không phải thủ tục: sửa nó phải kèm lý do, ở đây và ở
   * `vault.api.ts`.
   *
   * `listOwners` (28/08/2026) mở ra cho bảng điều khiển dựng khối "két lâu không đổi". Nó trả
   * đúng `VaultOwnerSummary` — kiểu mà bài kiểm ngay phía trên ghim từng tên trường, và trong
   * đó cố ý không có `label`, `kind` hay giá trị. Nên thứ rời khỏi vault vẫn là "hồ sơ nào có
   * két, mấy ngăn, đổi lần cuối bao giờ", đúng bằng `GET /vault/owners` đã mở cho SA/Admin từ
   * 26/08. Bên gọi tự gác vai — `DashboardService` chỉ dựng khối đó cho SA/Admin.
   *
   * `assertMemberCanSee` / `assertCanSee` / `onModuleInit` (08/09/2026) mở ra cho module `files`
   * hỏi ma trận quyền (rà soát 07/09, C1): Member bị `denied` trên một tài khoản dịch vụ trước
   * đây vẫn tải được biên bản bàn giao đính kèm của nó. Ba cái này an toàn với FR-026 vì chúng
   * trả `void` hoặc ném — KHÔNG cái nào trả về dữ liệu, nên không có gì để mà rò rỉ. Chúng chỉ
   * trả lời "có/không", và câu trả lời đó vốn đã lộ ra qua chính mã 403 của endpoint.
   *
   * `files` KHÔNG gọi thẳng ba hàm này (nó là module nền, không được biết tới `vault` —
   * dependency-cruiser chặn). Đường đi là `OwnerAccessRegistry` ở `common/`: `vault` ghi vào
   * sổ lúc khởi động (`onModuleInit`), `files` đọc sổ.
   *
   * Cái KHÔNG được thêm vào đây, ở bất kỳ hoàn cảnh nào: hàm trả giá trị, hàm trả nhãn ngăn,
   * hoặc hàm nhận nhiều chủ thể một lượt rồi trả kèm nội dung (FR-026).
   */
  it('VaultApiService chỉ xuất metadata và câu trả lời quyền', () => {
    const methods = Object.getOwnPropertyNames(VaultApiService.prototype)
      .filter((name) => name !== 'constructor')
      .sort();
    expect(methods).toEqual([
      'assertCanSee',
      'assertMemberCanSee',
      'countFor',
      'listFor',
      'listOwners',
      'onModuleInit',
    ]);
  });

  it('không file nào ngoài module vault đụng vào schema két sắt (AD-4)', () => {
    const scanned = allTsFiles(SRC);

    /*
     * CHỐT SÀN — bài này quét cây thư mục, nên nó có một chế độ hỏng rất im lặng: nếu `SRC`
     * trỏ sai chỗ, hoặc cây thư mục đổi, hoặc `allTsFiles` gặp lỗi và trả mảng rỗng, thì
     * `offenders` cũng rỗng và bài XANH VĨNH VIỄN mà không quét một file nào.
     *
     * `route-prefix.spec.ts:41-44` đã tự vá chế độ hỏng này cho mình; file này bị bỏ sót
     * (rà soát 07/09). Con số đặt thấp hơn thực tế nhiều (hiện ~200 file) để không phải sửa
     * mỗi lần thêm file, nhưng đủ cao để "quét được 0 file" không thể lọt.
     */
    expect(scanned.length).toBeGreaterThanOrEqual(120);

    /*
     * Bắt CẢ nháy đơn, nháy kép, backtick, và cả `import(...)`/`require(...)` động — bản
     * trước chỉ khớp `from '...'` nháy đơn, nên ba cách viết kia đi qua không ai thấy.
     */
    const touches = /(?:from|import|require)\s*\(?\s*['"`][^'"`]*vault\.schema['"`]/;
    const offenders = scanned
      .filter((file) => !file.includes(join('modules', 'vault')))
      .filter((file) => touches.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

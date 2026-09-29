import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../test/source-text';
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

  /**
   * QUÉT CẢ MODULE, KHÔNG PHẢI MỘT FILE.
   *
   * Chỉ soi `vault.controller.ts` thì thêm một route xuất file vào `break-glass.controller.ts`
   * hay `vault-access.controller.ts` là lọt cổng FR-026 ở tầng mã nguồn.
   *
   * Và so bằng regex thay vì `toContain('@get(\'...')`: so chuỗi chỉ bắt nháy ĐƠN, nên
   * `@Get("export.xlsx")` với nháy kép đi qua sạch sẽ.
   *
   * NGOẠI LỆ CÓ TÊN: `break-glass.controller.ts` được phép có `export.xlsx` — đó là nhật ký
   * DUYỆT (ai xin, đối tượng nào, lý do, ai quyết), không cột nào chạm giá trị trong két, và
   * FR-025 đòi nộp được cho auditor. Ngoại lệ khai ở đây, ngay cạnh luật, chứ không nằm trong
   * một chú thích ở file khác.
   */
  it('không có route xuất/tải hàng loạt — quét MỌI controller của module', () => {
    const ALLOWED = new Map([['break-glass.controller.ts', ["@Get('export.xlsx')"]]]);
    const controllers = readdirSync(__dirname).filter((file) => file.endsWith('.controller.ts'));

    // Chốt sàn: quét 0 file thì bài này xanh mà chẳng kiểm gì — đúng bẫy mà chốt sàn ở cuối
    // file dựng ra để chặn.
    expect(controllers.length).toBeGreaterThanOrEqual(4);

    for (const file of controllers) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      const allowed = ALLOWED.get(file) ?? [];
      for (const forbidden of ['export', 'download', 'xlsx', 'csv', 'all']) {
        /*
         * TỪ KHÓA Ở BẤT KỲ ĐÂU TRONG ĐƯỜNG DẪN, KHÔNG CHỈ Ở ĐẦU.
         *
         * Ghim từ khóa NGAY SAU dấu nháy thì chỉ bắt được route đặt ở gốc. Ba dạng dưới đây —
         * đúng hình dạng mà người thêm chức năng xuất sẽ viết — sẽ đi qua sạch sẽ:
         * `@Get(':id/export.xlsx')`, `@Get('secrets/download')`, `@Post('owners/export')`.
         *
         * `[^'"\`]*` cho phép từ khóa nằm giữa đường dẫn; `\\b` giữ cho nó vẫn là một TỪ,
         * không khớp nhầm `overall` hay `installed`.
         *
         * Khớp TRỌN lời gọi (tới hết `')`), không cắt ngang chuỗi: danh sách trắng bên dưới
         * so BẰNG ĐÚNG, nên hai bên phải cùng một hình dạng thì mới đối chiếu được.
         */
        const route = new RegExp(
          `@(?:Get|Post)\\(\\s*(['"\`])[^'"\`]*\\b${forbidden}\\b[^'"\`]*\\1\\)`,
          'i',
        );
        const hits = src.match(new RegExp(route.source, 'gi')) ?? [];
        /*
         * So BẰNG ĐÚNG chuỗi, không phải tiền tố: `startsWith` tha luôn cả
         * `@Get('export.xlsx-tat-ca')` chỉ vì nó bắt đầu giống hệt mục được phép.
         */
        const isRealViolation = hits.some(
          (hit) => !allowed.some((ok) => ok.toLowerCase() === hit.toLowerCase()),
        );
        /* Gói cả `file` và `forbidden` vào giá trị được so: Jest không nhận tham số message
           (chỉ Playwright/Vitest có), nên muốn thông báo lỗi nói được "file nào, từ khóa nào"
           thì phải để chúng nằm trong chính cái object đem so. */
        expect({ file, forbidden, violation: isRealViolation }).toMatchObject({ violation: false });
      }
    }
  });

  /**
   * Đường mở két (FR-022) là chỗ DUY NHẤT plaintext rời khỏi hệ thống. Ba thứ dưới đây mất
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
    /*
     * Guard chạy TOÀN CỤC (`app.module`), nên `@UseGuards(StepUpGuard)` gắn tay ở route vừa
     * thừa vừa gợi ý sai rằng route không gắn thì không được canh. Vế "guard có thật sự được
     * cắm không" do `auth/step-up-surface.spec.ts` giữ.
     */
    expect(decorators).not.toContain('@UseGuards(StepUpGuard)');
    expect(decorators).toContain("@Header('Cache-Control', 'no-store')");

    /**
     * Break-glass mở đường này cho Member — nhưng CHỈ khi thân hàm còn gọi `assertCanReveal`.
     *
     * Đây là thứ đáng khóa nhất của cả epic: bỏ `@Roles` đi là ai cũng thấy ngay, còn bỏ một
     * dòng `await this.breakGlass.assertCanReveal(...)` thì mọi test nghiệp vụ vẫn xanh và
     * mọi Member bỗng xem được mật khẩu của cả công ty. Không có gì đỏ để báo.
     */
    /*
     * LỘT CHÚ THÍCH TRƯỚC KHI SO, VÀ SO HÌNH DẠNG LỜI GỌI CHỨ KHÔNG SO CÁI TÊN.
     *
     * So `toContain('assertCanReveal')` trên lát cắt THÔ thì một dòng chú thích nhắc tới
     * `assertCanReveal` đủ thỏa khẳng định — bởi CHÚ THÍCH, không phải bởi hàng rào. Đột biến
     * chứng minh: thay lời gọi thật bằng `grantId = null` — tức bỏ trắng break-glass cho mọi
     * vai không phải SA/Admin — mà bài so thô vẫn 9/9 XANH. Bài kiểm càng viết chú thích cẩn
     * thận thì càng dễ tự thỏa mãn chính mình.
     */
    const body = stripComments(
      controller.slice(
        controller.indexOf('async reveal('),
        controller.indexOf('/** "Xóa" = thu hồi mềm.'),
      ),
    );
    if (decorators.includes("'member'")) {
      expect(body).toContain('await this.breakGlass.assertCanReveal(');
      /*
       * HÀNG RÀO PHẢI Ở DẠNG "KHÔNG PHẢI SA/ADMIN", KHÔNG PHẢI "CÓ PHẢI MEMBER".
       *
       * Chốt chuỗi `role === 'member'` là khóa đúng mẫu MỞ MẶC ĐỊNH: mọi vai khác đi thẳng,
       * không qua ma trận quyền — ngược AD-9.
       *
       * Chốt vị từ đảo lại thì ngày thêm vai thứ tư, vai đó vẫn phải đi qua `assertCanReveal`.
       * Vẫn là so CHUỖI NGUỒN chứ không chạy thử: thứ đang khóa ở đây là "dòng gác không được
       * biến mất", mà việc nó biến mất thì không test nghiệp vụ nào đỏ.
       */
      expect(body).toContain("role !== 'sa'");
      expect(body).toContain("role !== 'admin'");
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
   * Metadata mở cho Member nhưng vẫn phải qua kiểm tầng — chủ thể ngoài quyền là
   * 403, không phải một danh sách rỗng lặng lẽ.
   */
  it('đường đọc metadata của Member có kiểm tầng', () => {
    /*
     * LỘT CHÚ THÍCH + KHOÁ CẢ VỊ TỪ MẶC-ĐỊNH-ĐÓNG.
     *
     * 1. So trên lát cắt THÔ thì một dòng chú thích nhắc tên hàm đủ làm bài xanh (bài anh em
     *    ngay trên từng dính đúng chuyện đó). Lột trước rồi so.
     *
     * 2. Chỉ hỏi "còn gọi `assertCanSeeMetadata` không" là chưa đủ: đột biến đảo vị từ ở
     *    `vault.controller.ts` về `role === 'member'` — tức về mẫu MỞ MẶC ĐỊNH — vẫn để bài
     *    XANH, vì chuỗi kia không mất đi. Nên khoá luôn hình dạng vị từ ở cả hai đường.
     */
    const body = stripComments(
      controller.slice(controller.indexOf('async list('), controller.indexOf("@Get('verdict')")),
    );
    expect(body).toContain('assertCanSeeMetadata');
    expect(body).toContain("role !== 'sa'");
    expect(body).toContain("role !== 'admin'");
  });

  /**
   * `VaultDevicePanel.buildFor` là hàng rào THỨ TƯ của cùng một luật, và không E2E nào phân
   * biệt được hình dạng đúng với hình dạng sai của nó.
   *
   * Vì sao E2E không đủ: `role === 'member'` và `role !== 'sa' && role !== 'admin'` cho kết quả
   * GIỐNG HỆT nhau chừng nào hệ thống chỉ có ba vai. Bài E2E "khu Két sắt không lọt cho Member"
   * vì thế xanh ở cả hai hình dạng, kể cả hình dạng sai. Chỉ phép so hình dạng mới phân biệt
   * được — và đó chính là lý do file này tồn tại.
   */
  it('khu Két sắt trên trang thiết bị cũng mặc định ĐÓNG', () => {
    const panel = stripComments(
      readFileSync(join(__dirname, 'vault-device-panel.ts'), 'utf8'),
    );
    expect(panel).toContain("role !== 'sa'");
    expect(panel).toContain("role !== 'admin'");
    // Và KHÔNG được quay lại mẫu "có phải member": nó cho mọi vai khác đi thẳng.
    expect(panel).not.toContain("role === 'member'");
  });

  /**
   * Trang tổng `/vault/owners` là NGOẠI LỆ DUY NHẤT được liệt kê qua nhiều chủ
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
      const code = stripComments(ownersService);
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
   * `listOwners` mở ra cho bảng điều khiển dựng khối "két lâu không đổi". Nó trả
   * đúng `VaultOwnerSummary` — kiểu mà bài kiểm ngay phía trên ghim từng tên trường, và trong
   * đó cố ý không có `label`, `kind` hay giá trị. Nên thứ rời khỏi vault vẫn là "hồ sơ nào có
   * két, mấy ngăn, đổi lần cuối bao giờ", đúng bằng `GET /vault/owners` mở cho SA/Admin.
   * Bên gọi tự gác vai — `DashboardService` chỉ dựng khối đó cho SA/Admin.
   *
   * `assertMemberCanSee` / `assertCanSee` / `onModuleInit` mở ra cho module `files` hỏi ma
   * trận quyền: thiếu chúng thì Member bị `denied` trên một tài khoản dịch vụ vẫn tải được
   * biên bản bàn giao đính kèm của nó. Ba cái này an toàn với FR-026 vì chúng
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
     * `route-prefix.spec.ts` chặn cùng chế độ hỏng này theo cùng cách. Con số đặt thấp hơn
     * thực tế nhiều (hiện ~200 file) để không phải sửa
     * mỗi lần thêm file, nhưng đủ cao để "quét được 0 file" không thể lọt.
     */
    expect(scanned.length).toBeGreaterThanOrEqual(120);

    /*
     * Bắt CẢ nháy đơn, nháy kép, backtick, và cả `import(...)`/`require(...)` động — chỉ khớp
     * `from '...'` nháy đơn thì ba cách viết kia đi qua không ai thấy.
     */
    const touches = /(?:from|import|require)\s*\(?\s*['"`][^'"`]*vault\.schema['"`]/;
    const offenders = scanned
      .filter((file) => !file.includes(join('modules', 'vault')))
      .filter((file) => touches.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

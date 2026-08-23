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
    const listHandler = /@Get\(\)\s*\n\s*list\(([\s\S]*?)\) \{/.exec(controller);
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
    expect(decorators).toContain("@Roles('sa', 'admin')");

    // Tham số là IdParamDto (một id ở path), không phải body mang danh sách.
    expect(reveal![1]).toContain('IdParamDto');
    expect(reveal![1]).not.toContain('Body');
  });

  /**
   * api công khai của module là thứ các module khác gọi được. Khóa danh sách hàm ở đây lại:
   * thêm hàm mới phải sửa test này, tức là phải có người nhìn xem nó có trả bí mật không.
   */
  it('VaultApiService chỉ xuất metadata', () => {
    const methods = Object.getOwnPropertyNames(VaultApiService.prototype)
      .filter((name) => name !== 'constructor')
      .sort();
    expect(methods).toEqual(['countFor', 'listFor']);
  });

  it('không file nào ngoài module vault đụng vào schema két sắt (AD-4)', () => {
    const offenders = allTsFiles(SRC)
      .filter((file) => !file.includes(join('modules', 'vault')))
      .filter((file) => /from '.*vault\.schema'/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

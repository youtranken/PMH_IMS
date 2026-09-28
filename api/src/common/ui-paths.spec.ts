import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../test/source-text';
import { UI_PATHS } from './ui-paths';

/**
 * BẢN SAO PHẢI CÓ NGƯỜI CANH (B-07).
 *
 * `api/src/common/ui-paths.ts` là bản chép của `web/src/lib/routes.ts` — chép vì hai gói npm
 * rời nhau, không import qua lại được. Bài này là cái giá của phép chép ấy: nó đọc THẲNG file
 * bên web và so từng đường.
 *
 * Không có nó thì đây chỉ là bản sao thứ hai của cùng một sự thật, và bản sao không có cổng
 * sẽ trôi. F-09 trong cùng lượt rà soát này là ví dụ sống: năm bản chép của một hàm hiển thị
 * lịch sử, và chúng ĐÃ lệch — một bản có thêm một nhánh mà bốn bản kia không có, nên cùng một
 * thao tác cho ra hai màn hình khác nhau.
 */

const WEB_ROUTES = join(__dirname, '..', '..', '..', 'web', 'src', 'lib', 'routes.ts');
const API_SRC = join(__dirname, '..');

/** Thân hàm `xxx: (id: string) => \`/…/${id}\`` trong `routes.ts`, theo tên khoá. */
function webPathTemplate(key: string): string | null {
  const source = stripComments(readFileSync(WEB_ROUTES, 'utf8'));
  const fn = new RegExp(`\\b${key}:\\s*\\(id: string\\)\\s*=>\\s*\`([^\`]+)\``).exec(source);
  if (fn) return fn[1];
  const plain = new RegExp(`\\b${key}:\\s*'([^']+)'`).exec(source);
  return plain ? plain[1] : null;
}

describe('UI_PATHS bên api khớp `routes.ts` bên web', () => {
  it('đọc được file routes.ts của web (vế đối chứng cho chính bài này)', () => {
    // Đổi tên/dời file bên web mà bài này im lặng thì nó thôi canh gì cả — và sẽ im lặng
    // đúng vào lúc hai bản bắt đầu trôi khỏi nhau.
    expect(webPathTemplate('devices')).toBe('/devices');
  });

  it.each([
    ['device', 'device'],
    ['software', 'softwareItem'],
    ['ispLine', 'ispLine'],
    ['subnet', 'subnet'],
    ['serviceAccount', 'serviceAccount'],
  ])('`%s` sinh đúng đường mà web khai ở `%s`', (apiKey, webKey) => {
    const built = UI_PATHS[apiKey as 'device']('ID');
    const expected = webPathTemplate(webKey)?.replace('${id}', 'ID');
    expect(expected).not.toBeNull();
    expect(built).toBe(expected);
  });

  it('`approvals` — đường không tham số', () => {
    expect(UI_PATHS.approvals).toBe(webPathTemplate('approvals'));
  });

  it('`approval` — trang chi tiết một yêu cầu, đúng khuôn `approval` của web', () => {
    expect(UI_PATHS.approval('ID')).toBe(webPathTemplate('approval')?.replace('${id}', 'ID'));
    // id luôn là uuid, nhưng một ký tự lạ lọt vào cũng không được bẻ đường dẫn.
    expect(UI_PATHS.approval('a/b c')).toBe('/approvals/a%2Fb%20c');
  });

  it('`auditLog` — đúng đường `adminAuditLog`, người thao tác đi trong `q` đã mã hoá', () => {
    const url = new URL(UI_PATHS.auditLog('le+minh@pmh.com.vn'), 'http://x');
    expect(url.pathname).toBe(webPathTemplate('adminAuditLog'));
    expect(url.searchParams.get('q')).toBe('le+minh@pmh.com.vn');
  });

  it('`account` — đúng đường `adminAccounts`, email đi trong `q` đã mã hoá', () => {
    const url = new URL(UI_PATHS.account('le+minh@pmh.com.vn'), 'http://x');
    expect(url.pathname).toBe(webPathTemplate('adminAccounts'));
    expect(url.searchParams.get('q')).toBe('le+minh@pmh.com.vn');
  });
});

/**
 * VÀ KHÔNG AI ĐƯỢC TỰ GÕ LẠI MỘT ĐƯỜNG DẪN NỮA.
 *
 * Bài trên giữ cho bản sao khớp; bài dưới giữ cho không ai dựng bản sao THỨ BA. Bảy chỗ của
 * B-07 đều ra đời theo cùng một cách: người viết cần một link, gõ luôn chuỗi tại chỗ, và
 * không có gì hỏi lại.
 */
describe('Không file api nào tự gõ đường dẫn UI tiếng Việt', () => {
  /** Những lối viết cũ đã tìm thấy 22/09 — đủ để chặn tái phát, không cần đoán thêm. */
  const LEGACY = [
    '/thiet-bi/',
    '/phan-mem/',
    '/duong-truyen/',
    '/dia-chi-ip/',
    '/duyet-yeu-cau',
    '/tai-khoan-dich-vu/',
  ];

  function allSources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return allSources(full);
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });
  }

  it.each(LEGACY)('không chỗ nào còn dựng `%s`', (legacy) => {
    const guilty = allSources(API_SRC).filter((file) =>
      stripComments(readFileSync(file, 'utf8')).includes(legacy),
    );
    expect(guilty).toEqual([]);
  });

  it('phép quét có mắt — nó thấy được chuỗi mà nó đang tìm', () => {
    // Một lượt quét khớp đúng số không chuỗi trông y hệt một repo sạch. Repo này đã dựng nhầm
    // loại cổng đó bốn lần, nên probe trước, tin sau.
    expect(stripComments('const a = `/thiet-bi/${id}`;')).toContain('/thiet-bi/');
    expect(stripComments('// link: `/thiet-bi/${id}`')).not.toContain('/thiet-bi/');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `web/src/lib/note-secret.ts` là bản chép của `note-secret.ts` bên này (hai gói npm rời nhau).
 * Bản chép không có cổng sẽ trôi: form cho qua thứ server chặn (người dùng mất công gõ lại),
 * hoặc chặn thứ server cho qua (người dùng bị nói sai luật). So nguyên file, chỉ bỏ khác biệt
 * xuống dòng — file lẻ trong repo có CRLF.
 */
const WEB_LIB = join(__dirname, '..', '..', '..', 'web', 'src', 'lib');

/**
 * [file api, file web]. `phone-format.ts`: số điện thoại tách nhóm — server ghép chữ (khu
 * đường truyền trên trang thiết bị) và màn hình phải ra cùng một dạng (Q-18).
 */
const MIRRORS: [string, string][] = [
  [join(__dirname, 'note-secret.ts'), join(WEB_LIB, 'note-secret.ts')],
  [join(__dirname, 'phone-format.ts'), join(WEB_LIB, 'phone-format.ts')],
];

function read(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

describe('hàm thuần chép sang web: bản web trùng từng byte với bản api', () => {
  it.each(MIRRORS)('%s ≡ %s', (api, web) => {
    expect(read(web)).toBe(read(api));
  });
});

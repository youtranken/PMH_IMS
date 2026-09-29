import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { allControllers, stripComments } from '../../test/source-text';
import { CONFIG_KEYS } from './system-config.keys';
import { editableByKey } from './system-config.editable';

/**
 * BE-20 · trần theo phút của route nhạy cảm đi qua `@ConfigThrottle` (AD-11).
 *
 * Đọc mã nguồn vì hai lỗi ở đây đều IM LẶNG ở runtime:
 *   · một `@Throttle({ limit: N })` mới là con số lại nằm cứng trong code;
 *   · `@ConfigThrottle('tên-gõ-sai')` chỉ nổ khi đúng route đó bị gọi — có thể là trên prod.
 */

const CONTROLLERS = allControllers(join(__dirname, '..', '..'));

function usages(): { file: string; name: string }[] {
  return CONTROLLERS.flatMap((file) =>
    [...stripComments(readFileSync(file, 'utf8')).matchAll(/@ConfigThrottle\('([^']+)'\)/g)].map(
      (m) => ({ file: basename(file), name: m[1] }),
    ),
  );
}

describe('@ConfigThrottle trên controller', () => {
  it('không controller nào còn `@Throttle` viết số cứng', () => {
    const offenders = CONTROLLERS.filter((file) =>
      /@Throttle\(/.test(stripComments(readFileSync(file, 'utf8'))),
    ).map((file) => basename(file));
    expect(offenders).toEqual([]);
  });

  it('mọi tên khoá dùng trong `@ConfigThrottle` có thật và SA sửa được trên màn Tham số', () => {
    const bad = usages().filter(
      ({ name }) =>
        !(name in CONFIG_KEYS) ||
        editableByKey(CONFIG_KEYS[name as keyof typeof CONFIG_KEYS].key) === undefined,
    );
    expect(bad).toEqual([]);
  });

  it('các route từng có trần riêng vẫn có trần riêng', () => {
    const count = (file: string, name: string) =>
      usages().filter((u) => u.file === file && u.name === name).length;
    // Ba cửa nhận mã TOTP: đăng nhập bước 2, xác nhận cài lại 2 lớp, step-up mở két.
    expect(count('auth.controller.ts', 'rateTotpPerMinute')).toBe(3);
    expect(count('vault.controller.ts', 'rateSecretRevealPerMinute')).toBe(1);
    expect(count('files.controller.ts', 'rateFileUploadPerMinute')).toBe(1);
  });
});

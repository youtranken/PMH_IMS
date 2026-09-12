/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
// Tham chiếu ở đây mở đúng cho MỘT file, thay vì kéo kiểu Node vào toàn bộ mã app.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import vi from '@/locales/vi';
import { SECRET_OWNER_KIND_KEY, SECRET_OWNER_TYPES } from './secret-owner-kinds';

/**
 * ĐIỂM DANH: danh sách loại chủ thể cất secret của web phải khớp NGUYÊN VĂN bên API.
 *
 * Whitelist này có ba bản: API (`SECRET_OWNER_TYPES`), DB (`secret_owner_type_check`) và web.
 * Bài học 0033 đã ghi rằng tầng DB là tầng bị quên. Bài này canh cặp API↔web — cặp mà khi
 * lệch thì KHÔNG có gì đỏ, chỉ có một ô trống và một link dẫn sang trang khác (xem chú thích
 * dài ở `secret-owner-kinds.ts`).
 *
 * Đọc thẳng mã nguồn API chứ không chép danh sách sang đây: chép là dựng bản luật thứ hai,
 * và hai danh sách gõ tay cho cùng một khái niệm thì sớm muộn trả lời khác nhau — lúc đó cửa
 * canh vẫn xanh trong khi sản phẩm đã lệch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT_SERVICE = join(HERE, '..', '..', '..', 'api', 'src', 'modules', 'vault', 'vault.service.ts');

function apiOwnerTypes(): string[] {
  const source = readFileSync(VAULT_SERVICE, 'utf8');
  const decl = /export const SECRET_OWNER_TYPES = \[([^\]]*)\] as const;/.exec(source);
  if (!decl) return [];
  return [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** `ownerKind.device` → giá trị thật trong `vi.ts`, hoặc `undefined` nếu chưa khai. */
function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      vi,
    );
}

describe('Loại chủ thể cất secret', () => {
  const fromApi = apiOwnerTypes();

  /*
   * SÀN CHỐNG REGEX HỤT. Nếu khai báo bên API đổi hình dạng (xuống dòng khác đi, đổi tên),
   * regex trả về rỗng và bài "hai bên khớp nhau" sẽ xanh trong khi nó so hai mảng rỗng.
   */
  it('đọc được khai báo bên API (nếu không thì cả bài này vô nghĩa)', () => {
    expect(fromApi.length).toBeGreaterThanOrEqual(4);
  });

  it('web khai đúng bằng API, không thiếu không thừa', () => {
    expect([...SECRET_OWNER_TYPES].sort()).toEqual([...fromApi].sort());
  });

  it('mỗi loại đều có nhãn tiếng Việt thật trong vi.ts', () => {
    // `Record` đã bắt đủ khóa lúc biên dịch; đây là vế còn lại — khóa TỒN TẠI trong bản dịch.
    const thieu = SECRET_OWNER_TYPES.filter(
      (kind) => typeof lookup(SECRET_OWNER_KIND_KEY[kind]) !== 'string',
    );
    expect(thieu).toEqual([]);
  });
});

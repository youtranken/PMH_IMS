/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import vi from '@/locales/vi';
import { DISPOSAL_KIND_KEY, DISPOSAL_KINDS, disposalStatusKey } from './disposal-kinds';
import { OWNER_PATH } from './routes';

/**
 * ĐIỂM DANH: loại hồ sơ vào Kho thanh lý phía web phải khớp NGUYÊN VĂN bên API.
 *
 * Lệch hai bên thì không có gì đỏ: API trả một hàng loại lạ, web in ra một ô "Loại" trống và
 * một link `undefined`. Đọc thẳng mã nguồn API thay vì chép danh sách sang đây, vì hai danh
 * sách gõ tay cho cùng một khái niệm là hai câu trả lời chờ ngày khác nhau.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSAL_SERVICE = join(
  HERE, '..', '..', '..', 'api', 'src', 'modules', 'disposal', 'disposal.types.ts',
);

function apiKinds(): string[] {
  const source = readFileSync(DISPOSAL_SERVICE, 'utf8');
  const decl = /export const DISPOSAL_KINDS = \[([^\]]*)\] as const;/.exec(source);
  if (!decl) return [];
  return [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      vi,
    );
}

describe('Loại hồ sơ trong Kho thanh lý', () => {
  const fromApi = apiKinds();

  // Sàn chống regex hụt: khai báo bên API đổi hình dạng thì bài so hai mảng rỗng và xanh oan.
  it('đọc được khai báo bên API', () => {
    expect(fromApi.length).toBeGreaterThanOrEqual(4);
  });

  it('web khai đúng bằng API, không thiếu không thừa', () => {
    expect([...DISPOSAL_KINDS].sort()).toEqual([...fromApi].sort());
  });

  /** Q-10: đường truyền đã thanh lý vào kho cùng ba loại kia. */
  it('có đường truyền, nhãn "Đường truyền", link về trang chi tiết đường truyền', () => {
    expect(DISPOSAL_KINDS).toContain('isp');
    expect(lookup(DISPOSAL_KIND_KEY.isp)).toBe('Đường truyền');
    expect(OWNER_PATH.isp('abc')).toBe('/isp-lines/abc');
  });

  it('mỗi loại có nhãn thật trong vi.ts và một đường về hồ sơ gốc', () => {
    for (const kind of DISPOSAL_KINDS) {
      expect(typeof lookup(DISPOSAL_KIND_KEY[kind])).toBe('string');
      expect(OWNER_PATH[kind]('x')).toMatch(/\/x$/);
    }
  });

  /**
   * Trạng thái giữ TÊN CỦA MODULE CHỦ: người mở hồ sơ gốc phải gặp lại đúng chữ đã thấy ở kho.
   */
  it.each([
    ['retired', 'devices.statusRetired'],
    ['disabled', 'serviceAccounts.statusDisabled'],
    ['terminated', 'isp.statusTerminated'],
  ])('trạng thái %s đọc giống %s', (status, ownerKey) => {
    const key = disposalStatusKey(status);
    expect(key).not.toBeNull();
    expect(lookup(key as string)).toBe(lookup(ownerKey));
  });

  it('trạng thái lạ không có khoá — màn in nguyên văn thay vì một ô trống', () => {
    expect(disposalStatusKey('weird')).toBeNull();
  });
});

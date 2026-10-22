/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import vi from '@/locales/vi';
import { DEVICE_TYPE_ICON_KEYS } from './device-type-icon';

/**
 * ĐIỂM DANH (PW-A18): biểu tượng loại thiết bị web vẽ được phải khớp NGUYÊN VĂN danh sách đóng
 * bên API. Lệch thì không gì đỏ: API nhận một tên mà web vẽ ra hình "thiết bị chung", hoặc ô chọn
 * bày một hình mà API từ chối lúc Lưu. Đọc thẳng mã nguồn API, không chép danh sách sang đây.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const API_ICONS = join(HERE, '..', '..', '..', 'api', 'src', 'modules', 'catalog', 'device-type-icons.ts');

function apiIcons(): string[] {
  const decl = /export const DEVICE_TYPE_ICONS = \[([^\]]*)\] as const;/.exec(readFileSync(API_ICONS, 'utf8'));
  return decl ? [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
}

describe('Biểu tượng loại thiết bị — web ↔ API', () => {
  it('cùng danh sách, cùng thứ tự', () => {
    expect(apiIcons().length).toBeGreaterThan(0);
    expect([...DEVICE_TYPE_ICON_KEYS]).toEqual(apiIcons());
  });

  it('mỗi biểu tượng có tên tiếng Việt cho ô chọn', () => {
    const names = (vi as unknown as { deviceTypeIcon: Record<string, string> }).deviceTypeIcon;
    for (const key of DEVICE_TYPE_ICON_KEYS) expect(names?.[key], key).toMatch(/\S/);
  });
});

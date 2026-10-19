import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nhóm màn nặng, ít dùng hằng ngày phải tải lười ở `App.tsx`. Một dòng `import { X } from
 * '@/features/diagrams/…'` tĩnh là kéo cả nhóm đó (và draw.io bridge, lưới phiếu ISO…) về lại bundle
 * chính, mà build vẫn xanh — chỉ trang đầu chậm đi, không ai thấy.
 */
const LAZY_GROUPS = ['diagrams', 'iso', 'admin', 'dev'];

describe('App.tsx tải lười nhóm màn nặng', () => {
  const source = readFileSync(join(__dirname, 'App.tsx'), 'utf8');

  it.each(LAZY_GROUPS)('không import tĩnh @/features/%s', (group) => {
    const staticImport = new RegExp(`^import [^;]*from '@/features/${group}/`, 'm');
    expect(source).not.toMatch(staticImport);
  });

  it('nhánh route chính có Suspense để hiện Loading khi đang tải màn', () => {
    expect(source).toMatch(/<Suspense fallback=\{<Loading \/>\}>/);
  });
});

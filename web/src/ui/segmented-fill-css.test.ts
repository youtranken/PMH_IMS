import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Q-24: dải nút chọn một nằm trong một ô FORM trải hết bề ngang ô, các nút chia đều — không
 * dồn bên trái. jsdom không dựng bố cục, nên kiểm thẳng luật CSS và chỗ dùng.
 */

const SRC = join(__dirname, '..');
const css = readFileSync(join(SRC, 'css', 'form-layout.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const match = new RegExp(`(?:^|[},])\\s*[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`, 'm').exec(css);
  return match?.[1] ?? '';
}

describe('dải nút chọn một trong form trải đều', () => {
  it('`.field > .segmented` và `.segmented.fill` chiếm hết bề ngang', () => {
    for (const selector of ['.field > .segmented:not(.wrap)', '.segmented.fill']) {
      const body = ruleBody(selector);
      expect(body, selector).toMatch(/display:\s*flex/);
      expect(body, selector).toMatch(/width:\s*100%/);
    }
  });

  it('các nút con chia đều (flex 1 1 0) và chữ nằm giữa', () => {
    for (const selector of ['.field > .segmented:not(.wrap) > label', '.segmented.fill > button']) {
      const body = ruleBody(selector);
      expect(body, selector).toMatch(/flex:\s*1 1 0/);
      expect(body, selector).toMatch(/justify-content:\s*center/);
    }
  });

  /*
   * Dải nút trong hộp form nhưng KHÔNG nằm trong `Field` thì luật `.field > .segmented` không
   * tới — phải tự mang `fill`. Danh sách đích danh: thêm dải nút mới vào một form thì thêm vào đây.
   */
  it('dải nút trong hộp form ngoài `Field` mang lớp `fill`', () => {
    const files = [
      'features/software/assign-dialog.tsx',
      'features/diagrams/draft-from-port-map-dialog.tsx',
      'ui/port-form-dialog.tsx',
      'ui/break-glass.tsx',
    ];
    for (const file of files) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text, file).toMatch(/className=["{`'][^"}]*\bfill\b|segmented fill/);
    }
  });

  it('không file nào khác đặt lại bề ngang cho `.segmented` trong `.field`', () => {
    const cssDir = join(SRC, 'css');
    const offenders = readdirSync(cssDir)
      .filter((name) => name.endsWith('.css') && name !== 'form-layout.css')
      .filter((name) => statSync(join(cssDir, name)).isFile())
      .filter((name) => /\.field\s*>\s*\.segmented/.test(readFileSync(join(cssDir, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

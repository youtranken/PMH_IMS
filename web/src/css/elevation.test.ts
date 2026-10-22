import { describe, expect, it } from 'vitest';
import { cssRules, declValue, readCss } from '@/test/css-test-kit';

/**
 * DS-23 (Q-33): thẻ trên trang phẳng, chỉ có viền; bóng chỉ dành cho lớp NỔI trên trang, theo
 * đúng 3 nấc. Bóng rải khắp thẻ làm người dùng không còn phân biệt được cái gì đang nổi (menu,
 * hộp thoại) với cái nằm trên trang.
 */

function tokenBlock(theme: 'light' | 'dark'): string {
  const css = readCss('tokens.css');
  const start = theme === 'light' ? css.indexOf(':root {') : css.indexOf("html[data-theme='dark'] {");
  return css.slice(start, css.indexOf('\n}', start));
}

function boxShadow(file: string, selector: string): string | undefined {
  const r = cssRules(file).find((x) => x.selector === selector && x.media === null);
  if (!r) throw new Error(`thiếu ${selector} trong ${file}`);
  return declValue(r.body, 'box-shadow');
}

describe('3 nấc bóng cho lớp nổi', () => {
  it.each(['light', 'dark'] as const)('tokens (%s) có --elev-1/2/3 và không còn bóng cũ', (theme) => {
    const block = tokenBlock(theme);
    for (const n of [1, 2, 3]) expect(block, `--elev-${n}`).toMatch(new RegExp(`--elev-${n}:`));
    for (const old of ['--shadow:', '--shadow-pop:', '--shadow-lg:']) expect(block).not.toContain(old);
  });

  it.each([
    ['form-layout.css', '.fsel-menu', 1],
    ['form-layout.css', '.combo-menu', 1],
    ['form-layout.css', '.info-tip-pop', 1],
    ['datepicker.css', '.dp-pop', 1],
    ['primitives.css', '.popover-panel', 1],
    ['shared-kit.css', '.toast', 2],
    ['base.css', '.sidebar.is-drawer', 2],
    ['shared-kit.css', '.sticky-action-bar', 2],
    ['overlays.css', '.modal', 3],
    ['form-layout.css', '.sheet', 3],
    ['command-palette.css', '.cp', 3],
  ])('%s %s: nấc %i', (file, selector, n) => {
    expect(boxShadow(file, selector)).toBe(`var(--elev-${n})`);
  });
});

describe('thẻ trên trang phẳng, chỉ viền', () => {
  it.each([
    ['primitives.css', '.subnet-card:hover'],
    ['primitives.css', '.subnet-card.is-active'],
    ['relation-map.css', '.rmap-node'],
    ['relation-map.css', '.rmap-node:hover'],
    ['shared-kit.css', '.kpi:hover'],
  ])('%s %s: không bóng', (file, selector) => {
    expect(boxShadow(file, selector)).toBeUndefined();
  });

  it('ô số Bảng điều khiển: rê chuột chỉ đổi viền, không nhấc', () => {
    const r = cssRules('shared-kit.css').find((x) => x.selector === '.kpi:hover' && x.media === null)!;
    expect(declValue(r.body, 'border-color')).toBe('var(--primary)');
    expect(declValue(r.body, 'transform')).toBeUndefined();
  });
});

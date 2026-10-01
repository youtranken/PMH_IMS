import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nền hover CHUNG của nút (`surface-2`, gần trắng ở theme sáng) không được thắng luật của chính
 * component. Nếu nó thắng, nút nền trong suốt trên mặt tối — tiêu đề nhóm sidebar, link trên card
 * đăng nhập, nút × của toast — hover ra ô sáng với chữ sáng, đọc không được.
 *
 * jsdom không tính cascade, nên tính độ ưu tiên của selector thật trong CSS rồi so.
 */

const CSS_DIR = __dirname;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\r\n/g, '\n');
}

type Spec = [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Độ ưu tiên theo CSS Selectors 4: `:where()` = 0, `:not()`/`:is()` = selector bên trong. */
function specificity(selector: string): Spec {
  let s: Spec = [0, 0, 0];
  let rest = selector;
  for (;;) {
    const m = /:(where|not|is)\(/.exec(rest);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < rest.length && depth > 0; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')') depth--;
    }
    const inner = rest.slice(m.index + m[0].length, i - 1);
    if (m[1] !== 'where') s = add(s, specificity(inner));
    rest = rest.slice(0, m.index) + ' ' + rest.slice(i);
  }
  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  const classes = (rest.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (rest.replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+|#[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? [])
    .length;
  return add(s, [ids, classes, types]);
}

/** Mọi selector (đã tách dấu phẩy) có khai `background` ở mức gốc của file. */
function backgroundSelectors(file: string): string[] {
  const css = stripComments(readFileSync(join(CSS_DIR, file), 'utf8'));
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    if (!/(^|;|\s)background(-color)?\s*:/.test(m[2])) continue;
    out.push(...m[1].split(',').map((s) => s.trim()));
  }
  return out;
}

const globalHover = backgroundSelectors('base.css').filter((s) => /^button\b/.test(s) && s.includes(':hover') && !/[.[]/.test(s.replace(/:\w+\([^)]*\)/g, '')));

describe('base.css — nền hover chung của <button>', () => {
  it('chỉ có một luật hover chung, độ ưu tiên (0,0,1): thua mọi luật có class', () => {
    expect(globalHover).toHaveLength(1);
    expect(specificity(globalHover[0])).toEqual([0, 0, 1]);
  });

  it('bộ tính độ ưu tiên đúng với vài mẫu đã biết', () => {
    expect(specificity('button:hover:not(:disabled)')).toEqual([0, 2, 1]);
    expect(specificity('button:where(:hover:not(:disabled))')).toEqual([0, 0, 1]);
    expect(specificity('.nav-group-toggle')).toEqual([0, 1, 0]);
  });

  it.each([
    ['shell.css', '.nav-group-toggle'],
    ['auth.css', '.auth-link'],
    ['shared-kit.css', '.toast-close'],
  ])('%s %s: nền trong suốt của component thắng hover chung', (file, selector) => {
    const own = backgroundSelectors(file).find((s) => s === selector);
    expect(own, `${selector} phải tự khai background`).toBeDefined();
    expect(cmp(specificity(own!), specificity(globalHover[0]))).toBeGreaterThan(0);
  });
});

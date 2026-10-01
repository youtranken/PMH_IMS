import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Đọc CSS thật cho bài kiểm luật cascade. jsdom không tính cascade, nên các bài canh "luật A
 * không được đè luật B" phải tự tách selector rồi so độ ưu tiên ở đây.
 */

export type Spec = [number, number, number];
export type Rule = { selector: string; body: string; media: string | null };

const CSS_DIR = __dirname;

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\r\n/g, '\n');
}

export function readCss(file: string): string {
  return stripComments(readFileSync(join(CSS_DIR, file), 'utf8'));
}

const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const cmpSpec = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Độ ưu tiên theo CSS Selectors 4: `:where()` = 0, `:not()`/`:is()` = selector bên trong. */
export function specificity(selector: string): Spec {
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

/** Mọi luật của file, mỗi selector (đã tách dấu phẩy) một dòng; luật trong `@media` mang theo điều kiện. */
export function cssRules(file: string): Rule[] {
  const css = readCss(file);
  const out: Rule[] = [];
  const walk = (src: string, media: string | null) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      for (; j < src.length && depth > 0; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice(6).trim());
      else if (!head.startsWith('@')) {
        for (const sel of head.split(',')) out.push({ selector: sel.trim(), body, media });
      }
      i = j;
    }
  };
  walk(css, null);
  return out;
}

/** Giá trị của một thuộc tính trong thân luật (khai cuối thắng), hoặc `undefined`. */
export function declValue(body: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const m of body.matchAll(/(?:^|;|\s)([\w-]+)\s*:\s*([^;]+)/g)) {
    if (m[1] === prop) found = m[2].trim();
  }
  return found;
}

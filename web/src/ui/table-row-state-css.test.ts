import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nền trạng thái của dòng (quá hạn, lỗi) phải THẮNG sọc dòng chẵn — ở mọi theme.
 *
 * jsdom không tính cascade theo độ ưu tiên, nên không kiểm được bằng `getComputedStyle`. Ở đây
 * tính độ ưu tiên của selector thật trong CSS rồi so: luật trạng thái phải có độ ưu tiên lớn
 * hơn, hoặc bằng và đứng SAU luật sọc trong thứ tự nạp của `index.css`.
 */

const CSS_DIR = join(__dirname, '..', 'css');
const ORDER = readFileSync(join(__dirname, '..', 'index.css'), 'utf8')
  .split('\n')
  .map((line) => /@import '\.\/css\/([^']+)'/.exec(line)?.[1])
  .filter((name): name is string => Boolean(name));

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Độ ưu tiên (id, class/attr/pseudo-class, type) — đủ cho các selector đơn giản ở đây. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length;
  const types = (selector.replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(\([^)]*\))?|#[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? [])
    .length;
  return [ids, classes, types];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Mọi selector (kèm vị trí nạp) có khai `background` cho một `td`. */
function backgroundRules(): { selector: string; order: number }[] {
  const out: { selector: string; order: number }[] = [];
  let order = 0;
  for (const file of ORDER) {
    const css = stripComments(readFileSync(join(CSS_DIR, file), 'utf8'));
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      order += 1;
      if (!/(^|;)\s*background(-color)?\s*:/.test(match[2])) continue;
      for (const sel of match[1].split(',')) out.push({ selector: sel.trim(), order });
    }
  }
  return out;
}

describe('CSS bảng — nền trạng thái dòng thắng sọc dòng chẵn', () => {
  const rules = backgroundRules();
  const zebra = rules.find((r) => /tr:nth-child\(even\)\s*>?\s*td$/.test(r.selector) && r.selector.startsWith('table.table'));

  it.each(['row-danger', 'overdue', 'due-today'])('.%s', (state) => {
    expect(zebra).toBeDefined();
    const rule = rules.find((r) => new RegExp(`tr\\.${state} td$`).test(r.selector));
    expect(rule, `không thấy luật nền cho .${state}`).toBeDefined();
    const diff = cmp(specificity(rule!.selector), specificity(zebra!.selector));
    const wins = diff > 0 || (diff === 0 && rule!.order > zebra!.order);
    expect(wins, `${rule!.selector} thua ${zebra!.selector}`).toBe(true);
  });
});

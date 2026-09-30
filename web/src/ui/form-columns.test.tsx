import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormSection } from '@/ui/page-header';
import { renderWithI18n } from '@/test/test-utils';

/**
 * `FormSection columns={n}` chỉ có tác dụng khi `form-layout.css` có luật đọc `data-columns`
 * tương ứng. jsdom không dựng CSS (`css: false`), nên đọc thẳng file CSS: thiếu luật thì lưới rơi
 * về `auto-fill` và số cột do bề rộng hộp quyết định — không gì báo lỗi.
 */
const CSS = readFileSync(join(__dirname, '..', 'css', 'form-layout.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\r\n/g, '\n');

/** Luật `grid-template-columns` cho `[data-columns='n']` — ở gốc hoặc trong một `@media (max-width: Wpx)`. */
function columnsRule(n: number, maxWidth: number | null): string | null {
  const blocks: { media: number | null; body: string }[] = [];
  const mediaRe = /@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?\n)\}/g;
  let rootCss = CSS;
  for (const m of CSS.matchAll(mediaRe)) {
    blocks.push({ media: Number(m[1]), body: m[2] });
    rootCss = rootCss.replace(m[0], '');
  }
  blocks.push({ media: null, body: rootCss });
  let found: string | null = null;
  for (const block of blocks.filter((b) => b.media === maxWidth)) {
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    for (const r of block.body.matchAll(ruleRe)) {
      const selectors = r[1].split(',').map((s) => s.trim());
      if (!selectors.includes(`.form-grid[data-columns='${n}']`)) continue;
      const value = /grid-template-columns:\s*([^;]+);/.exec(r[2]);
      if (value) found = value[1].trim();
    }
  }
  return found;
}

describe('FormSection columns — luật CSS theo data-columns', () => {
  it('columns={4} viết data-columns="4"', () => {
    const { container } = renderWithI18n(
      <FormSection title="Cấu hình" columns={4}>
        <span />
      </FormSection>,
    );
    expect(container.querySelector('.form-grid')).toHaveAttribute('data-columns', '4');
  });

  it('lưới 4 cột: rộng là 4, khổ vừa (≤860px) còn 2, khổ hẹp (≤560px) còn 1', () => {
    expect(columnsRule(4, null)).toBe('repeat(4, minmax(0, 1fr))');
    expect(columnsRule(4, 860)).toBe('repeat(2, minmax(0, 1fr))');
    expect(columnsRule(4, 560)).toBe('minmax(0, 1fr)');
  });

  it('lưới 3 cột giữ nguyên nếp cũ (bộ đọc CSS ở trên đọc đúng)', () => {
    expect(columnsRule(3, null)).toBe('repeat(3, minmax(0, 1fr))');
    expect(columnsRule(3, 860)).toBe('repeat(2, minmax(0, 1fr))');
    expect(columnsRule(3, 560)).toBe('minmax(0, 1fr)');
  });
});

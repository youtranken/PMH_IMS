import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Badge "việc chờ" (cam) trên menu: chữ phải đọc được ở CẢ HAI giao diện. Chế độ tối là mặc
 * định (Q-21), và `--ink` ở đó là chữ sáng — chữ sáng trên cam chỉ ~1,4:1. axe không bắt được
 * vì badge `aria-hidden`, nên bài này tự tính tương phản từ chính tokens.css.
 */
const CSS = join(__dirname);
const tokens = readFileSync(join(CSS, 'tokens.css'), 'utf8');
const shell = readFileSync(join(CSS, 'shell.css'), 'utf8');

function block(selectorStart: string): string {
  const at = tokens.indexOf(selectorStart);
  return tokens.slice(at, tokens.indexOf('\n}', at));
}

function token(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`thiếu --${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('Badge cam trên menu đọc được ở sáng lẫn tối', () => {
  it('.nav-badge.warn dùng chữ --on-brand (tối cố định), không dùng --ink', () => {
    const rule = shell.match(/\.nav-badge\.warn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/color:\s*var\(--on-brand\)/);
  });

  it.each([
    ['sáng', ':root {'],
    ['tối', "html[data-theme='dark'] {"],
  ])('giao diện %s: --on-brand trên --warm ≥ 4,5:1', (_, start) => {
    const css = block(start);
    expect(contrast(token(css, 'on-brand'), token(css, 'warm'))).toBeGreaterThanOrEqual(4.5);
  });
});

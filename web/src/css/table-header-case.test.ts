import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DS-09 (Q-33): tiêu đề cột 12px chữ thường, đậm vừa. Chữ in hoa giãn chữ làm tiêu đề dài gấp
 * rưỡi và bảng tràn ngang ở laptop.
 */
const css = (name: string) => readFileSync(join(__dirname, name), 'utf8');

function rule(src: string, selector: string): string {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`thiếu ${selector}`);
  return src.slice(at, src.indexOf('}', at));
}

describe('Tiêu đề cột bảng', () => {
  it.each([
    ['table.css', 'table.table thead th'],
    ['primitives.css', '.seat-hd'],
  ])('%s %s: 12px, không in hoa, không giãn chữ', (file, selector) => {
    const r = rule(css(file), selector);
    expect(r).toMatch(/font-size:\s*var\(--fs-xs\)/);
    expect(r).toMatch(/font-weight:\s*var\(--fw-semibold\)/);
    expect(r).not.toMatch(/text-transform:\s*uppercase/);
    expect(r).not.toMatch(/letter-spacing/);
  });
});

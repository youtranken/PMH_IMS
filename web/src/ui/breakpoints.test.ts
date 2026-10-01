import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '@/ui/breakpoints';

const CSS_DIR = join(__dirname, '..', 'css');
const css = readdirSync(CSS_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(CSS_DIR, f), 'utf8'))
  .join('\n');

const SRC = join(__dirname, '..');
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return tsxFiles(path);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [path] : [];
  });
}

describe('mốc bề ngang dùng chung', () => {
  it.each(Object.entries(BREAKPOINTS))('%s = %s có @media trùng trong css/', (_name, query) => {
    expect(css).toContain(`@media ${query}`);
  });

  it('JS không tự viết chuỗi "(max-width: …px)" ngoài ui/breakpoints.ts', () => {
    const offenders = tsxFiles(SRC)
      .filter((file) => !file.endsWith(join('ui', 'breakpoints.ts')))
      .filter((file) => /['"`]\(max-width:\s*\d+px\)['"`]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repo không có luật `.btn` cho `<a>`: dáng nút của <button> đến từ chính phần tử `button`
 * (base.css). `<Link className="btn …">` vì thế hiện ra như một link chữ trần giữa hàng nút.
 * Link mang dáng nút phải dùng `linkbtn` (`linkbtn primary`, `linkbtn sm`).
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('<Link> dáng nút dùng lớp linkbtn', () => {
  it('không có <Link className="btn…">', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(__dirname)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<Link\b[^>]*?className=\{?["'`]btn\b/g)) {
        offenders.push(`${file.slice(__dirname.length + 1)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

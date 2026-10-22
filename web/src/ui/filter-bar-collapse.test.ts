import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FilterBar chỉ gập ở màn hẹp khi có `onClear` (ui/filter-bar.tsx: thiếu nó là `folded` luôn sai).
 * Quên truyền thì ở 390px các ô lọc xếp chồng đẩy danh sách xuống dưới màn — đúng lỗi ở Đường
 * truyền / Tài khoản dịch vụ, màn tra hotline lúc mất mạng.
 */

const ROOT = join(__dirname, '..');
const CONTROLS = /<(Select|ChipToggleGroup|SegmentedRadio|DatePicker|FilterToggle|Combobox|select)\b/g;
const AUTO_COLLAPSE_FROM = 3;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('FilterBar có từ 3 ô lọc phải gập được ở màn hẹp', () => {
  it('mọi FilterBar ≥3 ô lọc đều truyền activeCount + onClear', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(ROOT)) {
      if (file.endsWith('filter-bar.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/<FilterBar\b([\s\S]*?)\n\s*>([\s\S]*?)<\/FilterBar>/g)) {
        const [, props, body] = m;
        const controls = body.match(CONTROLS)?.length ?? 0;
        if (controls >= AUTO_COLLAPSE_FROM && !(/\bonClear=/.test(props) && /\bactiveCount=/.test(props))) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length} (${controls} ô lọc)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Hai khóa cùng tên trong một khối của vi.ts: khóa SAU thắng âm thầm, và build không đỏ vì
 * tsconfig.app.json không bật `strict`. Từng xảy ra: `iso.incident.periodOf` khai lần hai làm phụ
 * đề phiếu 0206 in nhầm "Tính vào kỳ" của hộp sửa.
 */
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'vi.ts'), 'utf8');

function duplicateKeys(text: string): string[] {
  const stack: Set<string>[] = [new Set()];
  const path: string[] = [];
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    const open = /^\s*([A-Za-z_][\w]*)\s*:\s*\{\s*$/.exec(line);
    if (open) {
      const key = open[1];
      if (stack[stack.length - 1].has(key)) found.push([...path, key].join('.'));
      stack[stack.length - 1].add(key);
      stack.push(new Set());
      path.push(key);
      continue;
    }
    if (/^\s*\},?\s*$/.test(line)) {
      if (stack.length > 1) {
        stack.pop();
        path.pop();
      }
      continue;
    }
    const leaf = /^\s*([A-Za-z_][\w]*)\s*:/.exec(line);
    if (leaf) {
      const key = leaf[1];
      if (stack[stack.length - 1].has(key)) found.push([...path, key].join('.'));
      stack[stack.length - 1].add(key);
    }
  }
  return found;
}

describe('vi.ts — không khóa trùng tên trong cùng khối', () => {
  it('bộ dò bắt được khóa trùng (vế đối chứng)', () => {
    expect(duplicateKeys("const vi = {\n  a: {\n    x: '1',\n    x: '2',\n  },\n};")).toEqual(['a.x']);
  });

  it('vi.ts không có khóa trùng', () => {
    expect(duplicateKeys(src)).toEqual([]);
  });
});

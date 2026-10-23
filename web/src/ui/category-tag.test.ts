/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * DS-14: chỉ TRẠNG THÁI mang viên màu (`.badge`). Phân loại — loại hồ sơ, loại nút sơ đồ, vai trò,
 * giao thức, loại chủ két, loại sự cố — là nhãn viền trung tính (`.tag`); cùng một kiểu viên thì
 * "Super Admin" đọc như một trạng thái cạnh "Đang dùng".
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY = /disposalItemKindLabel\(|ROLE_LABEL\[|NODE_TYPE_KEY\[|protocolBoth|SECRET_OWNER_KIND_KEY\[|groupLabelKey\(|KIND_LABEL\[|accounts\.roleSa|presentation\.badge/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('Nhãn phân loại dùng .tag, không dùng viên trạng thái', () => {
  it('không phần tử className="badge …" nào bọc nhãn phân loại', () => {
    const bad: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/<span className=(?:"badge[^"]*"|\{[^}]*badge[^}]*\})[^>]*>([\s\S]{0,160}?)<\/span>/g)) {
        if (CATEGORY.test(match[1])) bad.push(`${relative(SRC, file)}: ${match[0].split('\n')[0].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

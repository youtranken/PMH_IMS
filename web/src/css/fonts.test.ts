import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DS-12: `--font` ghi 'Inter' mà không có @font-face nào — mỗi máy rơi về một font khác (Ubuntu ra
 * DejaVu rộng hơn ~15%, chữ bị cắt "…" khác nhau), và font mono của hệ thống làm rời dấu tiếng Việt
 * ("hô` sơ"). Font tự host trong web/public/fonts, đủ bộ Latin + tiếng Việt.
 */
const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const PUBLIC = join(__dirname, '../../public');

const faces = [...tokens.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe('Font tự host (Inter + JetBrains Mono)', () => {
  it.each(['Inter', 'JetBrains Mono'])('%s có đủ bộ latin, latin-ext, vietnamese', (family) => {
    const own = faces.filter((f) => f.includes(`font-family: '${family}'`));
    const files = own.map((f) => f.match(/url\('([^']+)'\)/)?.[1] ?? '');
    expect(files.some((u) => u.includes('vietnamese'))).toBe(true);
    expect(files.some((u) => /-latin-wght/.test(u))).toBe(true);
    expect(files.some((u) => u.includes('latin-ext'))).toBe(true);
    for (const url of files) expect(existsSync(join(PUBLIC, url)), url).toBe(true);
    for (const face of own) expect(face).toMatch(/font-display:\s*swap/);
  });

  it('--font và --mono mở đầu bằng đúng font đã khai', () => {
    expect(tokens).toMatch(/--font:\s*'Inter',/);
    expect(tokens).toMatch(/--mono:\s*'JetBrains Mono',/);
  });
});

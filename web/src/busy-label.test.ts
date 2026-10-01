import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nút Lưu trong lúc ghi nói "Đang lưu…" (`common.saving`), không phải "Đang tải…"
 * (`common.loading` là câu của lượt ĐỌC). Người dùng thấy "Đang tải…" trên nút Lưu thì tưởng
 * hệ thống đang nạp lại, chưa lưu, và bấm lại.
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('nhãn nút Lưu khi đang ghi', () => {
  it('không còn `? t("common.loading") : t("common.save")`', () => {
    const offenders = tsxFiles(__dirname).filter((file) =>
      /common\.loading['"]\)\s*:\s*t\(['"]common\.save['"]\)/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('khoá common.saving có trong vi.ts', async () => {
    const vi = (await import('@/locales/vi')).default as { common: Record<string, string> };
    expect(vi.common.saving).toBe('Đang lưu…');
  });
});

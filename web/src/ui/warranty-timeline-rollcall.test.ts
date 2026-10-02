import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanSource } from '@/test/scan-source';

/**
 * ĐIỂM DANH: mọi chỗ vẽ `<WarrantyTimeline` trong `features/` phải khai `notCounted`.
 *
 * Thanh hạn nằm ở trang chi tiết — đúng nơi hồ sơ đã thanh lý / ngừng dùng vẫn mở được. Quên
 * prop thì trang chi tiết vẽ sọc đỏ "Quá hạn 800 ngày" cho một hồ sơ mà danh sách (đã khai
 * `notCounted` cho `ExpiryBadge`) nói là "Không tính hạn": hai màn nói ngược nhau về một hồ sơ.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = scanSource(join(SRC, 'features'), /\.tsx$/).filter(
  (file) => !/\.test\.tsx$/.test(file) && readFileSync(file, 'utf8').includes('<WarrantyTimeline'),
);

/** Từng phần tử `<WarrantyTimeline …/>` (tới `/>` đầu tiên) kèm số dòng để báo lỗi. */
function usages(file: string): { line: number; text: string }[] {
  const source = readFileSync(file, 'utf8');
  const out: { line: number; text: string }[] = [];
  let at = source.indexOf('<WarrantyTimeline');
  while (at !== -1) {
    const end = source.indexOf('/>', at);
    out.push({ line: source.slice(0, at).split('\n').length, text: source.slice(at, end) });
    at = source.indexOf('<WarrantyTimeline', end);
  }
  return out;
}

describe('mọi WarrantyTimeline ở màn nghiệp vụ đều khai notCounted', () => {
  it('tìm được các chỗ dùng (vế đối chứng)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(FILES.map((file) => [file.slice(SRC.length + 1).replace(/\\/g, '/'), file]))(
    '%s',
    (_name, file) => {
      const missing = usages(file)
        .filter((use) => !use.text.includes('notCounted='))
        .map((use) => use.line);
      expect(missing).toEqual([]);
    },
  );
});

import { describe, expect, it } from 'vitest';
import { fileCountFact } from '@/ui/tab-counts';

const format = (count: number) => `${count} Tệp`;

describe('fileCountFact — ô "Giấy tờ" ở dải đầu trang', () => {
  it.each([
    [{ files: 3, filesLoading: false }, '3 Tệp'],
    [{ files: 0, filesLoading: false }, null],
    [{ files: undefined, filesLoading: true }, '…'],
    // Lỗi hoặc không có quyền xem giấy tờ: không treo "…" mãi — ô về "chưa khai".
    [{ files: undefined, filesLoading: false }, null],
  ])('%o → %s', (counts, expected) => {
    expect(fileCountFact({ secrets: undefined, ...counts }, format)).toBe(expected);
  });
});

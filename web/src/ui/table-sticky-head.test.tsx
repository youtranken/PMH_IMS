import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/ui/data-table';
import { renderWithI18n, screen } from '@/test/test-utils';

/**
 * TB-02/DS-13: kéo xuống dòng 30 là không còn biết cột nào là cột nào. `overflow-x: auto` của
 * khung bảng biến nó thành vùng cuộn, nên `position: sticky` của tiêu đề bám vào khung (không
 * cuộn dọc) chứ không bám vào trang. Bảng VỪA bề ngang thì khung đổi sang `clip` (không tạo
 * vùng cuộn) và tiêu đề dính dưới topbar; bảng rộng hơn khung vẫn cuộn ngang như cũ.
 */
interface Row {
  name: string;
}
const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Tên' }];
const wrap = () => screen.getByRole('table').closest('.table-wrap') as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe('Tiêu đề cột dính', () => {
  it('bảng vừa bề ngang: khung đánh dấu data-fit', () => {
    renderWithI18n(<DataTable data={[{ name: 'A' }]} columns={COLUMNS} emptyText="—" />);
    expect(wrap()).toHaveAttribute('data-fit', 'true');
  });

  it('bảng rộng hơn khung: không data-fit (vẫn cuộn ngang được)', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    renderWithI18n(<DataTable data={[{ name: 'A' }]} columns={COLUMNS} emptyText="—" />);
    expect(wrap()).not.toHaveAttribute('data-fit');
  });

  it('CSS: khung vừa thì clip, tiêu đề dính dưới topbar', () => {
    const css = readFileSync(join(__dirname, '..', 'css', 'table.css'), 'utf8');
    expect(css).toMatch(/\.table-wrap\[data-fit\]\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/\.table-wrap\[data-fit\][^{]*thead th\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--topbar-h\)/);
  });
});

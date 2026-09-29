import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, groupStarts } from '@/ui/data-table';
import { Select } from '@/ui/select';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

function viewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

interface Ev {
  id: string;
  day: string;
  what: string;
}
const EVENTS: Ev[] = [
  { id: '1', day: '2026-09-29', what: 'Đăng nhập' },
  { id: '2', day: '2026-09-29', what: 'Xem két' },
  { id: '3', day: '2026-09-28', what: 'Đăng xuất' },
];
const COLUMNS: ColumnDef<Ev>[] = [{ accessorKey: 'what', header: 'Việc' }];
const GROUP = { key: (row: Ev) => row.day, label: (key: string) => `Ngày ${key}` };

describe('groupStarts', () => {
  it('đánh dấu dòng đầu và mọi dòng đổi khoá so với dòng liền trước', () => {
    expect(groupStarts(EVENTS, (row) => row.day)).toEqual([true, false, true]);
    expect(groupStarts([], (row: Ev) => row.day)).toEqual([]);
  });
});

describe('DataTable `groupBy` — một dòng tiêu đề mỗi nhóm', () => {
  it('bảng: tiêu đề nhóm là ô `colgroup` đứng trước dòng đầu nhóm', () => {
    viewport(1280);
    renderWithI18n(<DataTable data={EVENTS} columns={COLUMNS} emptyText="—" groupBy={GROUP} />);
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Việc', 'Ngày 2026-09-29', 'Ngày 2026-09-28']);
    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows).toEqual([
      'Việc',
      'Ngày 2026-09-29',
      'Đăng nhập',
      'Xem két',
      'Ngày 2026-09-28',
      'Đăng xuất',
    ]);
  });

  it('thẻ gọn ≤600px: tiêu đề nhóm là heading trước thẻ đầu nhóm', () => {
    viewport(390);
    renderWithI18n(
      <MemoryRouter>
        <DataTable
          data={EVENTS}
          columns={COLUMNS}
          emptyText="—"
          groupBy={GROUP}
          mobileCard={{ title: (row) => row.what }}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Ngày 2026-09-29',
      'Ngày 2026-09-28',
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('Select `group` — tiêu đề nhóm trong menu', () => {
  it('kẻ tên nhóm trước option đầu mỗi nhóm; option vẫn chọn được như cũ', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <Select
        value=""
        ariaLabel="Hành động"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Đăng nhập', group: 'Đăng nhập & phiên' },
          { value: 'b', label: 'Đăng xuất', group: 'Đăng nhập & phiên' },
          { value: 'c', label: 'Xem két', group: 'Két' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Hành động' }));
    const titles = Array.from(document.querySelectorAll('.fsel-group')).map((node) => node.textContent);
    expect(titles).toEqual(['Đăng nhập & phiên', 'Két']);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await userEvent.click(screen.getByRole('option', { name: 'Xem két' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
});

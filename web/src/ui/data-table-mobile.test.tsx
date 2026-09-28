import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { RowActions } from '@/ui/row-actions';
import { fireEvent, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

interface Dev {
  id: string;
  code: string;
  name: string;
  site: string;
  status: string;
}
const DATA: Dev[] = [
  { id: '1', code: 'SW-E2E-CORE-01', name: 'Switch lõi', site: 'HCM', status: 'Đang dùng' },
  { id: '2', code: 'FW-E2E-01', name: 'Tường lửa', site: 'HN', status: 'Trong kho' },
];
const COLUMNS: ColumnDef<Dev>[] = [
  { accessorKey: 'code', header: 'Mã' },
  { accessorKey: 'name', header: 'Tên' },
  { accessorKey: 'site', header: 'Site' },
  { id: 'act', header: 'Thao tác', enableSorting: false, cell: () => <button>⋯</button> },
];

const CARD: MobileCard<Dev> = {
  title: (r) => r.code,
  subtitle: (r) => r.name,
  meta: (r) => `${r.site} · tủ A`,
  badge: (r) => <span className="badge ok">{r.status}</span>,
  actions: (r) => (
    <RowActions label={`Thao tác với ${r.code}`} items={[{ key: 'e', label: 'Sửa', onSelect: () => {} }]} />
  ),
};

/** Giả lập bề ngang màn hình cho `matchMedia` (jsdom không có). */
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

describe('DataTable — thẻ gọn trên điện thoại (`mobileCard`)', () => {
  it('≤600px có `mobileCard`: vẽ danh sách thẻ, không vẽ bảng', () => {
    viewport(390);
    renderWithI18n(
      <MemoryRouter>
        <DataTable data={DATA} columns={COLUMNS} emptyText="Trống" mobileCard={{ ...CARD, href: (r) => `/devices/${r.id}` }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('table')).toBeNull();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);

    const first = within(cards[0]);
    // Định danh là link DUY NHẤT của thẻ, phủ cả thẻ (một điểm Tab, không lồng tương tác).
    expect(first.getByRole('link', { name: 'SW-E2E-CORE-01' })).toHaveAttribute('href', '/devices/1');
    expect(first.getByText('Switch lõi')).toBeInTheDocument();
    expect(first.getByText('HCM · tủ A')).toBeInTheDocument();
    expect(first.getByText('Đang dùng')).toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Thao tác với SW-E2E-CORE-01' })).toBeInTheDocument();
  });

  it('bấm vào thẻ (link phủ) thì sang trang chi tiết', async () => {
    viewport(390);
    renderWithI18n(
      <MemoryRouter initialEntries={['/devices']}>
        <Routes>
          <Route
            path="/devices"
            element={
              <DataTable data={DATA} columns={COLUMNS} emptyText="Trống" mobileCard={{ ...CARD, href: (r) => `/devices/${r.id}` }} />
            }
          />
          <Route path="/devices/:id" element={<p>Trang chi tiết</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'FW-E2E-01' }));
    expect(screen.getByText('Trang chi tiết')).toBeInTheDocument();
  });

  it('có `onRowClick` (không href): cả thẻ là một nút, menu ⋯ không mở dòng', async () => {
    viewport(390);
    const onRowClick = vi.fn();
    renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="Trống" onRowClick={onRowClick} mobileCard={CARD} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'SW-E2E-CORE-01' }));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));

    onRowClick.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Thao tác với FW-E2E-01' }));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Sửa' })).toBeInTheDocument();
  });

  it('`rowClassName` áp lên thẻ (dòng quá hạn vẫn nổi trên điện thoại)', () => {
    viewport(390);
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="Trống"
        mobileCard={CARD}
        rowClassName={(r) => (r.id === '2' ? 'row-danger' : '')}
      />,
    );
    const cards = screen.getAllByRole('listitem');
    expect(cards[1]).toHaveClass('list-card', 'row-danger');
    expect(cards[0]).not.toHaveClass('row-danger');
  });

  it('rỗng thì hiện câu rỗng, không phải danh sách trống trơn', () => {
    viewport(390);
    renderWithI18n(<DataTable data={[]} columns={COLUMNS} emptyText="Chưa có thiết bị" mobileCard={CARD} />);
    expect(screen.getByText('Chưa có thiết bị')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('màn rộng: vẫn là bảng dù có `mobileCard`', () => {
    viewport(1280);
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" mobileCard={CARD} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('không truyền `mobileCard`: điện thoại vẫn là bảng như cũ', () => {
    viewport(390);
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" stackOnMobile />);
    expect(screen.getByRole('table')).toHaveClass('table-stack');
  });
});

describe('DataTable — cột dính khi bảng cuộn ngang', () => {
  it('`stickyActions` dính cột CUỐI (th + td), cột khác không dính', () => {
    const { container } = renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="Trống" stickyActions />,
    );
    const header = screen.getByRole('columnheader', { name: 'Thao tác' });
    expect(header).toHaveClass('col-sticky-end');
    const lastCells = container.querySelectorAll('tbody tr td:last-child');
    expect(lastCells).toHaveLength(2);
    lastCells.forEach((td) => expect(td).toHaveClass('col-sticky-end'));
    expect(screen.getByRole('columnheader', { name: /Mã/ })).not.toHaveClass('col-sticky-end');
  });

  it('khai `meta.sticky` trên cột: dính mép trái, giữ className sẵn có', () => {
    const cols: ColumnDef<Dev>[] = [
      { accessorKey: 'code', header: 'Mã', meta: { sticky: 'start', className: 'mono' } },
      ...COLUMNS.slice(1),
    ];
    const { container } = renderWithI18n(<DataTable data={DATA} columns={cols} emptyText="Trống" />);
    const td = container.querySelector('tbody tr td')!;
    expect(td).toHaveClass('col-sticky-start', 'mono');
  });

  it('không bật thì không cột nào dính (hành vi cũ)', () => {
    const { container } = renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" />);
    expect(container.querySelector('.col-sticky-end, .col-sticky-start')).toBeNull();
  });

  it('bảng còn cột khuất bên phải thì khung đánh dấu để vẽ bóng mép cột dính', () => {
    const { container } = renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="Trống" stickyActions />,
    );
    const wrap = container.querySelector('.table-wrap') as HTMLElement;
    expect(wrap).not.toHaveAttribute('data-more-end');
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: 1400 });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 800 });
    fireEvent.scroll(wrap);
    expect(wrap).toHaveAttribute('data-more-end', 'true');
  });
});

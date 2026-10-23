import { describe, it, expect, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/ui/data-table';
import {
  renderWithI18n,
  screen,
  within,
  waitFor,
  userEvent,
  fireEvent,
} from '@/test/test-utils';

interface Row {
  name: string;
  qty: number;
}
const DATA: Row[] = [
  { name: 'Banana', qty: 3 },
  { name: 'apple', qty: 10 },
  { name: 'Cherry', qty: 1 },
];
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Tên' },
  { accessorKey: 'qty', header: 'SL' },
  { id: 'act', header: 'Hành động', enableSorting: false, cell: () => <button>x</button> },
];

/** Tên ở cột đầu của từng dòng body (bỏ dòng header). */
function rowNames(): (string | null)[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent);
}

describe('DataTable', () => {
  it('render đủ dòng + cột', () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" />);
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(rowNames()).toEqual(['Banana', 'apple', 'Cherry']);
  });

  it('bấm header cột sắp xếp: asc → desc → về nguyên bản', async () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" />);
    const slHeader = screen.getByRole('button', { name: /SL/ });
    await userEvent.click(slHeader);
    expect(rowNames()).toEqual(['Cherry', 'Banana', 'apple']); // 1,3,10
    await userEvent.click(slHeader);
    expect(rowNames()).toEqual(['apple', 'Banana', 'Cherry']); // 10,3,1
    await userEvent.click(slHeader);
    expect(rowNames()).toEqual(['Banana', 'apple', 'Cherry']); // nguyên bản
  });

  it('th mang aria-sort phản ánh trạng thái sắp xếp', async () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" />);
    const slHeaderCell = screen.getByText('SL').closest('th')!;
    expect(slHeaderCell).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: /SL/ }));
    expect(slHeaderCell).toHaveAttribute('aria-sort', 'ascending');
  });

  it('cột enableSorting=false không cho bấm sắp xếp', async () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="Trống" />);
    // header "Hành động" không được bọc trong button
    expect(screen.getByText('Hành động').closest('button')).toBeNull();
  });

  it('ô tìm kiếm lọc dòng theo nội dung (debounce)', async () => {
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="Trống"
        searchPlaceholder="Tìm"
      />,
    );
    await userEvent.type(screen.getByLabelText('Tìm'), 'app');
    // apple luôn hiện (cả khi chưa lọc) → phải đợi Banana BIẾN MẤT sau debounce, không đợi apple.
    await waitFor(() =>
      expect(screen.queryByText('Banana')).not.toBeInTheDocument(),
    );
    expect(rowNames()).toEqual(['apple']);
  });

  it('data rỗng → hiện emptyText', () => {
    renderWithI18n(<DataTable data={[]} columns={COLUMNS} emptyText="Chưa có dữ liệu" />);
    expect(screen.getByText('Chưa có dữ liệu')).toBeInTheDocument();
  });

  it('rowClassName gán class <tr> theo dữ liệu dòng', () => {
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="Trống"
        rowClassName={(r) => (r.qty > 5 ? 'hot' : '')}
      />,
    );
    expect(screen.getByText('apple').closest('tr')).toHaveClass('hot'); // qty 10
    expect(screen.getByText('Banana').closest('tr')).not.toHaveClass('hot');
  });

  it('manualSorting: bấm header gọi onSortingChange, KHÔNG sắp client', async () => {
    const onSortingChange = vi.fn();
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="Trống"
        manualSorting
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );
    expect(rowNames()).toEqual(['Banana', 'apple', 'Cherry']);
    await userEvent.click(screen.getByRole('button', { name: /SL/ }));
    expect(onSortingChange).toHaveBeenCalled();
    // giữ nguyên thứ tự — server sẽ trả data đã sắp, client không tự sắp
    expect(rowNames()).toEqual(['Banana', 'apple', 'Cherry']);
  });

  it('onRowClick: bấm dòng gọi callback; nút stopPropagation thì không', async () => {
    const onRowClick = vi.fn();
    const cols: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Tên' },
      {
        id: 'act',
        header: '',
        enableSorting: false,
        cell: () => <button onClick={(e) => e.stopPropagation()}>x</button>,
      },
    ];
    renderWithI18n(
      <DataTable data={DATA} columns={cols} emptyText="Trống" onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText('Banana'));
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Banana' }),
    );
    onRowClick.mockClear();
    await userEvent.click(screen.getAllByText('x')[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('tableClassName nối thêm vào <table>', () => {
    const { container } = renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="Trống"
        tableClassName="board-table"
      />,
    );
    expect(container.querySelector('table')).toHaveClass('table', 'board-table');
  });
});

describe('DataTable — bấm dòng', () => {
  it('bấm ô chữ thì mở dòng; bấm nút trong dòng thì KHÔNG (nút tự lo việc của nó)', async () => {
    const onRowClick = vi.fn();
    renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="—" onRowClick={onRowClick} />,
    );
    await userEvent.click(screen.getByText('Banana'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'x' })[0]);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('cột sắp được mà chưa sắp mang aria-sort="none"; cột không sắp được thì không', () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="—" />);
    expect(screen.getByRole('columnheader', { name: /Tên/ })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Hành động' })).not.toHaveAttribute('aria-sort');
  });

  it('expandText: nút bung mang chữ nói rõ bung ra thấy gì', () => {
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="—"
        renderExpanded={() => <p>chi tiết</p>}
        expandText={(r) => `${r.qty} license`}
      />,
    );
    expect(screen.getByRole('button', { name: '3 license' })).toHaveAttribute('aria-expanded', 'false');
  });
});

/** TB-07 / UX-E37: bấm dòng mở chi tiết ở mọi danh sách; Ctrl+bấm / chuột giữa mở tab mới. */
describe('DataTable — rowHref', () => {
  it('Ctrl+bấm dòng mở tab mới theo rowHref, không gọi onRowClick', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onRowClick = vi.fn();
    renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="—" onRowClick={onRowClick} rowHref={(row) => `/x/${row.name}`} />,
    );
    const cell = screen.getByRole('cell', { name: 'Banana' });
    fireEvent.click(cell, { ctrlKey: true });
    expect(open).toHaveBeenCalledWith('/x/Banana', '_blank', 'noopener');
    expect(onRowClick).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it('bấm thường vẫn gọi onRowClick', async () => {
    const onRowClick = vi.fn();
    renderWithI18n(
      <DataTable data={DATA} columns={COLUMNS} emptyText="—" onRowClick={onRowClick} rowHref={(row) => `/x/${row.name}`} />,
    );
    await userEvent.click(screen.getByRole('cell', { name: 'Banana' }));
    expect(onRowClick).toHaveBeenCalledWith(DATA[0]);
  });
});

/** Dòng được trỏ tới bằng link (sổ NAT `?rule=`) mang aria-current — trình đọc màn hình biết đang ở đâu. */
describe('DataTable — rowCurrent', () => {
  it('gắn aria-current lên đúng dòng', () => {
    renderWithI18n(<DataTable data={DATA} columns={COLUMNS} emptyText="—" rowCurrent={(row) => row.name === 'apple'} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.filter((r) => r.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(within(rows.find((r) => r.getAttribute('aria-current') === 'true')!).getByText('apple')).toBeInTheDocument();
  });
});

/*
 * TB-19: thẻ dọc trên điện thoại (`.table-stack td[data-empty]`) ẩn ô chưa khai. Bảng tự gắn
 * `data-empty` cho ô chỉ có "—" hay rỗng — màn không phải tự nhớ gắn từng ô.
 */
describe('DataTable — ô trống tự mang data-empty', () => {
  interface Spot {
    id: string;
    site: string | null;
  }
  const SPOT_COLUMNS: ColumnDef<Spot>[] = [
    { accessorKey: 'id', header: 'Mã' },
    { accessorKey: 'site', header: 'Site', cell: ({ row }) => row.original.site ?? '—' },
    { id: 'blank', header: 'Ghi chú', cell: () => null },
    { id: 'act', header: 'Thao tác', cell: () => <button type="button">Sửa</button> },
  ];
  const cellOf = (label: string) => screen.getAllByRole('row')[1].querySelector(`td[data-label="${label}"]`)!;

  it('ô "—" và ô rỗng có data-empty; ô có chữ hay có nút thì không', async () => {
    renderWithI18n(<DataTable data={[{ id: 'A1', site: null }]} columns={SPOT_COLUMNS} emptyText="—" stackOnMobile />);
    await waitFor(() => expect(cellOf('Site')).toHaveAttribute('data-empty'));
    expect(cellOf('Ghi chú')).toHaveAttribute('data-empty');
    expect(cellOf('Mã')).not.toHaveAttribute('data-empty');
    expect(cellOf('Thao tác')).not.toHaveAttribute('data-empty');
  });

  it('ô được điền sau đó thì bỏ data-empty', async () => {
    const view = renderWithI18n(<DataTable data={[{ id: 'A1', site: null }]} columns={SPOT_COLUMNS} emptyText="—" stackOnMobile />);
    await waitFor(() => expect(cellOf('Site')).toHaveAttribute('data-empty'));
    view.rerender(<DataTable data={[{ id: 'A1', site: 'HCM' }]} columns={SPOT_COLUMNS} emptyText="—" stackOnMobile />);
    await waitFor(() => expect(cellOf('Site')).not.toHaveAttribute('data-empty'));
  });

  it('ô chỉ có dấu không chữ mà có tên (chấm trạng thái mang title / aria-label) không trống', async () => {
    const columns: ColumnDef<Spot>[] = [
      { accessorKey: 'id', header: 'Mã' },
      { id: 'dot', header: 'Trạng thái', cell: () => <span className="dot" title="Đang chạy" /> },
      { id: 'swatch', header: 'Màu', cell: () => <i aria-label="Xanh" /> },
    ];
    renderWithI18n(<DataTable data={[{ id: 'A1', site: null }]} columns={columns} emptyText="—" stackOnMobile />);
    await waitFor(() => expect(cellOf('Mã')).toBeInTheDocument());
    expect(cellOf('Trạng thái')).not.toHaveAttribute('data-empty');
    expect(cellOf('Màu')).not.toHaveAttribute('data-empty');
  });

  it('không đụng ô của bảng lồng trong ô (màn tự quyết data-empty của bảng con)', async () => {
    const columns: ColumnDef<Spot>[] = [
      { accessorKey: 'id', header: 'Mã' },
      {
        id: 'inner',
        header: 'Bảng con',
        cell: () => (
          <table>
            <tbody>
              <tr>
                <td data-label="Con" data-testid="inner-filled">
                  —
                </td>
                <td data-label="Con2" data-testid="inner-empty" data-empty="">
                  có chữ
                </td>
              </tr>
            </tbody>
          </table>
        ),
      },
    ];
    renderWithI18n(<DataTable data={[{ id: 'A1', site: null }]} columns={columns} emptyText="—" stackOnMobile />);
    await waitFor(() => expect(cellOf('Mã')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('inner-filled')).not.toHaveAttribute('data-empty');
    expect(screen.getByTestId('inner-empty')).toHaveAttribute('data-empty');
  });
});

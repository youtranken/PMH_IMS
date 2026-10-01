import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/ui/data-table';
import { ExpandHeader } from '@/ui/expand-header';
import { ExpandPanel } from '@/ui/expand-panel';
import { renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

interface Row {
  id: string;
  code: string;
  count: number;
}
const DATA: Row[] = [
  { id: 'a', code: 'LT-01', count: 3 },
  { id: 'b', code: 'LT-02', count: 1 },
];
const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'code', header: 'Mã' }];

/**
 * MỘT mẫu bung dòng cho mọi bảng (Q-18: /devices và /software phải giống nhau): mũi tên ở cột
 * đầu, số đếm nằm trong TÊN của nút (qua `expandLabel`) và trong đầu khu bung (`ExpandHeader`)
 * — không in chữ lên nút.
 */
describe('DataTable — mẫu bung dòng chuẩn', () => {
  function renderTable() {
    renderWithI18n(
      <DataTable
        data={DATA}
        columns={COLUMNS}
        emptyText="—"
        expandLabel={(row, open) => `${open ? 'Thu gọn' : 'Mở rộng'} ${row.code} — ${row.count} phần mềm`}
        renderExpanded={(row) => (
          <ExpandHeader title="Phần mềm đang cài" count={row.count} />
        )}
      />,
    );
  }

  it('nút mũi tên ở ô ĐẦU của dòng, chỉ có hình, tên mang số đếm', () => {
    renderTable();
    const firstRow = screen.getAllByRole('row')[1];
    const firstCell = within(firstRow).getAllByRole('cell')[0];
    const toggle = within(firstCell).getByRole('button', { name: 'Mở rộng LT-01 — 3 phần mềm' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.textContent).toBe('');
    expect(toggle.querySelector('svg.chevron')).not.toBeNull();
  });

  it('bấm là bung; aria-controls trỏ đúng khu bung, trong đó có đầu khu chuẩn', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: 'Mở rộng LT-01 — 3 phần mềm' }));

    const toggle = screen.getByRole('button', { name: 'Thu gọn LT-01 — 3 phần mềm' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByText('Phần mềm đang cài')).toBeInTheDocument();
  });

  it('mỗi dòng một aria-controls riêng', () => {
    renderTable();
    const [one, two] = screen.getAllByRole('button', { name: /Mở rộng/ });
    expect(one.getAttribute('aria-controls')).toBeTruthy();
    expect(one.getAttribute('aria-controls')).not.toBe(two.getAttribute('aria-controls'));
  });
});

describe('ExpandHeader — đầu khu bung dòng', () => {
  it('tiêu đề + số đếm + nút thao tác chính', async () => {
    const user = userEvent.setup();
    const onAssign = vi.fn();
    renderWithI18n(
      <ExpandHeader
        title="Máy đang dùng"
        count={4}
        action={{ label: 'Gán vào máy', onClick: onAssign }}
      />,
    );
    expect(screen.getByText('Máy đang dùng')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gán vào máy' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('số 0 vẫn hiện (khu bung rỗng vẫn phải nói là rỗng)', () => {
    renderWithI18n(<ExpandHeader title="Máy đang dùng" count={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('không có action thì không có nút; có `note` thì hiện cạnh số đếm', () => {
    renderWithI18n(<ExpandHeader title="Ghế" count="5/5" note="Hết ghế" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
    expect(screen.getByText('Hết ghế')).toBeInTheDocument();
  });

  it('nút thao tác tắt được', () => {
    renderWithI18n(
      <ExpandHeader title="Ghế" action={{ label: 'Gán vào máy', onClick: vi.fn(), disabled: true }} />,
    );
    expect(screen.getByRole('button', { name: 'Gán vào máy' })).toBeDisabled();
  });
});

/*
 * MỘT khung cho mọi khu bung (Q-20): đầu khu và thân nằm trong CÙNG một hộp có đệm. Trước đây
 * /devices đặt `ExpandHeader` ngoài hộp có đệm (đầu khu dí sát mép trái) còn /software đặt trong.
 */
describe('ExpandPanel — khung chung của khu bung dòng', () => {
  it('đầu khu và thân nằm cùng một khung; đầu khu đứng trước thân', () => {
    renderWithI18n(
      <ExpandPanel title="License đang cài" count={2}>
        <p>thân khu</p>
      </ExpandPanel>,
    );
    const head = screen.getByTestId('expand-header');
    const body = screen.getByText('thân khu');
    const panel = head.closest('.exp-panel');
    expect(panel).not.toBeNull();
    expect(panel?.contains(body)).toBe(true);
    expect(head.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(head).toHaveTextContent('2');
  });

  it('chuyển tiếp note và action sang đầu khu', async () => {
    const onAssign = vi.fn();
    renderWithI18n(
      <ExpandPanel title="Ghế" count="5/5" note="Hết ghế" action={{ label: 'Gán vào máy', onClick: onAssign }}>
        <span />
      </ExpandPanel>,
    );
    expect(screen.getByText('Hết ghế')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gán vào máy' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
  });
});

/*
 * Luật của ô hàng bung PHẢI nhắm ô CON TRỰC TIẾP của `tr.exp`. Viết dạng hậu duệ
 * (`tr.exp td`) thì nó rơi cả vào ô của bảng con nằm trong khu bung: mọi ô bảng ghế mất đệm,
 * có vạch đứt trên đầu và nền xám. jsdom không dựng CSS nên đọc thẳng file.
 */
describe('CSS hàng bung — không rò vào bảng con', () => {
  const css = readFileSync(join(__dirname, '..', 'css', 'primitives.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  it('mọi luật `tr.exp … td` đều là ô con trực tiếp (`tr.exp > td`)', () => {
    const rules = css.match(/tr\.exp(?::hover)?\s*>?\s*td/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).toMatch(/>\s*td$/);
  });
});

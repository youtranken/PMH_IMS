import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { AssignDialog } from './assign-dialog';
import type { SoftwareRow } from './software-types';

/**
 * SW-053 — gán license cho NHIỀU máy một lượt, điều khoản ghế dùng chung cho cả lô. Gửi TUẦN
 * TỰ từng máy; hỏng giữa chừng thì dừng, bỏ máy đã gán khỏi lô, nói rõ máy hỏng.
 */

afterEach(() => vi.unstubAllGlobals());

const SOFTWARE: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-LO',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 10,
  seatUsed: 0,
  startDate: null,
  endDate: '2030-01-01',
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

const DEVICES = [
  { id: 'd1', code: 'PC-E2E-01', name: 'Máy 1' },
  { id: 'd2', code: 'PC-E2E-02', name: 'Máy 2' },
];

const CATALOG = {
  vendors: [],
  sites: [],
  cabinets: [],
  deviceTypes: [],
  departments: [{ id: 'dep1', name: 'Kế toán', active: true }],
};

function mockFetch(
  failOn?: string,
  quick: { items: typeof DEVICES; total?: number } = { items: DEVICES },
  holding: string[] = [],
) {
  const posts: Record<string, unknown>[] = [];
  const gets: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') gets.push(url);
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
      if (url.includes('department=') || url.includes('assignedTo=') || url.includes('status=in_use')) {
        return Promise.resolve(
          jsonResponse(200, { items: quick.items, total: quick.total ?? quick.items.length }),
        );
      }
      if (url.startsWith('/api/v1/devices')) {
        return Promise.resolve(jsonResponse(200, { items: DEVICES }));
      }
      if (url.startsWith('/api/v1/software/sw1/assignments') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(jsonResponse(200, holding.map((deviceId) => ({ id: `s-${deviceId}`, deviceId }))));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      posts.push(body);
      if (body.deviceId === failOn) {
        return Promise.resolve(
          jsonResponse(400, { code: 'SEAT_LIMIT_REACHED', message: 'Hết ghế.' }),
        );
      }
      return Promise.resolve(jsonResponse(201, { assignment: { id: `a-${String(body.deviceId)}` } }));
    }),
  );
  return Object.assign(posts, { gets });
}

async function pick(code: string) {
  const box = screen.getByPlaceholderText('Tìm máy trong kho…');
  await userEvent.type(box, 'PC-E2E');
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(code) }));
}

function render(onDone = vi.fn(), software: SoftwareRow = SOFTWARE) {
  renderWithI18n(
    <ToastProvider>
      <AssignDialog software={software} csrfToken="t" onClose={vi.fn()} onDone={onDone} />
    </ToastProvider>,
  );
  return onDone;
}

describe('AssignDialog — gán nhiều máy một lượt', () => {
  it('chọn hai máy thành chip, gửi hai lượt cùng điều khoản, báo số máy', async () => {
    const posts = mockFetch();
    const onDone = render();
    await pick('PC-E2E-01');
    await pick('PC-E2E-02');
    const chips = screen.getByRole('list', { name: 'Máy sẽ gán' });
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'PC-E2E-01✕',
      'PC-E2E-02✕',
    ]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Hợp đồng' }), 'HD-01');
    await userEvent.click(screen.getByRole('button', { name: 'Gán 2 máy' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith([], 2));
    expect(posts.map((body) => [body.deviceId, body.contract])).toEqual([
      ['d1', 'HD-01'],
      ['d2', 'HD-01'],
    ]);
  });

  it('máy thứ hai hỏng → dừng, máy đã gán rời lô, câu lỗi nêu máy hỏng', async () => {
    mockFetch('d2');
    const onDone = render();
    await pick('PC-E2E-01');
    await pick('PC-E2E-02');
    await userEvent.click(screen.getByRole('button', { name: 'Gán 2 máy' }));
    expect(await screen.findByText(/Đã gán 1 máy, dừng ở PC-E2E-02/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    const chips = screen.getByRole('list', { name: 'Máy sẽ gán' });
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'PC-E2E-02✕',
    ]);
  });

  it('bỏ một máy khỏi lô bằng nút ✕ của chip', async () => {
    mockFetch();
    render();
    await pick('PC-E2E-01');
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ PC-E2E-01 khỏi lô' }));
    expect(screen.queryByRole('list', { name: 'Máy sẽ gán' })).toBeNull();
  });
});

const chipCodes = () =>
  within(screen.getByRole('list', { name: 'Máy sẽ gán' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

async function quickPick(by: 'Phòng ban' | 'Người sử dụng', value: string) {
  await userEvent.click(screen.getByRole('radio', { name: by }));
  const label = by === 'Phòng ban' ? 'Tên phòng ban' : 'Tên người sử dụng';
  await userEvent.type(screen.getByRole('combobox', { name: label }), value);
  await userEvent.click(screen.getByRole('button', { name: 'Thêm các máy' }));
}

describe('AssignDialog — chọn nhanh cả lô theo phòng ban / người sử dụng (Q-15)', () => {
  it('ba chế độ Máy | Phòng ban | Người sử dụng — mỗi chế độ chỉ bày đúng ô của nó', async () => {
    mockFetch();
    render();
    const modes = screen.getByRole('radiogroup', { name: 'Chọn máy theo' });
    expect(within(modes).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Máy',
      'Phòng ban',
      'Người sử dụng',
    ]);
    expect(within(modes).getByRole('radio', { name: 'Máy' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByPlaceholderText('Tìm máy trong kho…')).toBeInTheDocument();

    await userEvent.click(within(modes).getByRole('radio', { name: 'Phòng ban' }));
    expect(screen.queryByPlaceholderText('Tìm máy trong kho…')).toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Tên phòng ban' })).toBeInTheDocument();

    await userEvent.click(within(modes).getByRole('radio', { name: 'Người sử dụng' }));
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Tên người sử dụng' })).toBeInTheDocument();
  });

  it('câu "Thêm mọi máy…" nằm sau nút (i), không in thẳng', async () => {
    mockFetch();
    render();
    await userEvent.click(screen.getByRole('radio', { name: 'Phòng ban' }));
    expect(screen.queryByText(/Thêm mọi máy đang dùng khớp đúng tên này/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Giải thích: Tên phòng ban' }));
    expect(screen.getByText(/Thêm mọi máy đang dùng khớp đúng tên này/)).toBeInTheDocument();
  });

  it('chế độ Người sử dụng gợi ý tên người đang giữ máy', async () => {
    mockFetch(undefined, {
      items: [
        { id: 'd1', code: 'PC-E2E-01', name: 'Máy 1', assignedTo: 'Chị Bình' },
        { id: 'd2', code: 'PC-E2E-02', name: 'Máy 2', assignedTo: 'Chị Bình' },
        { id: 'd3', code: 'PC-E2E-03', name: 'Máy 3', assignedTo: null },
      ] as unknown as typeof DEVICES,
    });
    render();
    await userEvent.click(screen.getByRole('radio', { name: 'Người sử dụng' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Tên người sử dụng' }), 'bin');
    expect(await screen.findAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Chị Bình' })).toBeInTheDocument();
  });

  it('chọn một phòng ban → thêm sẵn mọi máy đang dùng của phòng, bỏ máy đã có license', async () => {
    const calls = mockFetch(undefined, {
      items: [...DEVICES, { id: 'd3', code: 'PC-E2E-03', name: 'Máy 3' }],
    }, ['d1']);
    const onDone = render();
    await quickPick('Phòng ban', 'Kế toán');
    expect(await screen.findByText(/Đã thêm 2 máy của Kế toán\./)).toBeInTheDocument();
    expect(screen.getByText(/1 máy đã có license này, bỏ qua\./)).toBeInTheDocument();
    expect(chipCodes()).toEqual(['PC-E2E-02✕', 'PC-E2E-03✕']);
    const query = calls.gets.find((url) => url.includes('department='))!;
    expect(query).toContain(`department=${encodeURIComponent('Kế toán')}`);
    expect(query).toContain('status=in_use');
    expect(query).toContain('usable=true');

    // Vẫn bỏ từng máy được, rồi gán phần còn lại.
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ PC-E2E-03 khỏi lô' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gán vào máy' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith([], 1));
    expect(calls.map((body) => body.deviceId)).toEqual(['d2']);
  });

  it('theo người sử dụng gửi assignedTo; không có máy nào thì nói rõ, không thêm gì', async () => {
    const calls = mockFetch(undefined, { items: [] });
    render();
    await quickPick('Người sử dụng', 'Chị Bình');
    expect(await screen.findByText('Không có máy đang dùng nào của Chị Bình.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Máy sẽ gán' })).toBeNull();
    expect(calls.gets.some((url) => url.includes(`assignedTo=${encodeURIComponent('Chị Bình')}`))).toBe(true);
  });

  it('lô chọn nhanh vượt số ghế còn lại → hỏi lý do NGAY, như gán tay', async () => {
    mockFetch();
    render(vi.fn(), { ...SOFTWARE, seatTotal: 2, seatUsed: 1 });
    expect(screen.queryByRole('textbox', { name: 'Lý do vượt số ghế' })).toBeNull();
    await quickPick('Phòng ban', 'Kế toán');
    expect(await screen.findByRole('textbox', { name: 'Lý do vượt số ghế' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gán vượt ghế' })).toBeInTheDocument();
  });

  it('bấm Thêm khi chưa gõ tên → nhắc, không hỏi API', async () => {
    const calls = mockFetch();
    render();
    await userEvent.click(screen.getByRole('radio', { name: 'Phòng ban' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thêm các máy' }));
    expect(await screen.findByText('Gõ tên phòng ban hoặc người sử dụng.')).toBeInTheDocument();
    expect(calls.gets.some((url) => url.includes('department='))).toBe(false);
  });
});

describe('AssignDialog — đặt nhanh hạn của ghế', () => {
  it('hàng +1/+2/+3 năm tính từ ngày bắt đầu; chưa có ngày bắt đầu thì nút tắt', () => {
    mockFetch();
    render();
    const group = screen.getByRole('group', { name: 'Đặt nhanh ngày hết hạn' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['+1 năm', '+2 năm', '+3 năm']);
    for (const button of buttons) expect(button).toBeDisabled();
  });
});

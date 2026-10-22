import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { SoftwareForm } from './software-form';
import type { SoftwareRow } from './software-types';

/**
 * Form phần mềm theo Q-27: hàng Tên · Mã · Nhà cung cấp; khối "Ghế và hợp đồng" có ô tick "mỗi
 * ghế có hợp đồng, giấy tờ và ghi chú riêng" (chỉ bật được từ 2 ghế); "Lưu rồi gán vào máy";
 * "Mua thêm đợt mới" điền sẵn theo đợt trước và gợi ý mã kế tiếp.
 */

afterEach(() => vi.unstubAllGlobals());

const CATALOG = { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] };

const WIN25: SoftwareRow = {
  id: 'w1',
  code: 'LIC-WIN25-01',
  name: 'Windows Server 2025',
  kind: 'license',
  licenseModel: 'perpetual',
  vendorId: null,
  vendorName: null,
  seatTotal: 2,
  seatUsed: 2,
  startDate: '2025-03-12',
  endDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

function mockFetch() {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Promise.resolve(jsonResponse(200, { id: 'new1' }));
      }
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
      if (url.startsWith('/api/v1/software?')) {
        return Promise.resolve(jsonResponse(200, { items: [WIN25, { ...WIN25, id: 'w2', code: 'LIC-WIN25-02', seatTotal: 3 }], total: 2 }));
      }
      if (url.startsWith('/api/v1/software/new1')) return Promise.resolve(jsonResponse(200, { ...WIN25, id: 'new1', seats: [] }));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return writes;
}

function render(props: { row?: SoftwareRow; batchFrom?: SoftwareRow; onSaved?: (r?: { id: string; assign: boolean }) => void } = {}) {
  return renderWithI18n(
    <ToastProvider>
      <SoftwareForm row={props.row ?? null} batchFrom={props.batchFrom} csrfToken="csrf" onClose={() => {}} onSaved={props.onSaved ?? (() => {})} />
    </ToastProvider>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, code = 'LIC-E2E-GHE') {
  await user.type(screen.getByRole('textbox', { name: 'Tên hồ sơ' }), 'Veeam');
  await user.type(screen.getByRole('textbox', { name: 'Mã hồ sơ' }), code);
  await user.click(screen.getByRole('radio', { name: 'Vĩnh viễn' }));
}

describe('Form phần mềm — ghế và hợp đồng (Q-27)', () => {
  it('Mã · Tên · Nhà cung cấp đứng một hàng, theo đúng thứ tự (FM-25: Mã trước Tên)', () => {
    mockFetch();
    render();
    const section = screen.getByRole('heading', { name: 'Nhận dạng' }).closest('section') as HTMLElement;
    const grid = section.querySelector('.form-grid');
    expect(grid).toHaveAttribute('data-columns', '3');
    const labels = Array.from(section.querySelectorAll('label')).map((label) => label.textContent?.replace('*', '').trim());
    expect(labels.slice(0, 3)).toEqual(['Mã hồ sơ', 'Tên hồ sơ', 'Nhà cung cấp']);
  });

  it('ô tick khoá khi dưới 2 ghế; 3 ghế + tick → bảng Ghế 1…3, ẩn hợp đồng / ghi chú / giấy tờ chung, gửi seats', async () => {
    const writes = mockFetch();
    render();
    const user = userEvent.setup();
    await fillRequired(user);
    const tick = screen.getByRole('checkbox', { name: /^Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng/ });
    expect(tick).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Số ghế' }), '3');
    expect(tick).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Số hợp đồng / PO' })).toBeInTheDocument();

    await user.click(tick);
    expect(screen.queryByRole('textbox', { name: 'Số hợp đồng / PO' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Ghi chú' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Giấy tờ đính kèm' })).toBeNull();
    for (const n of [1, 2, 3]) expect(screen.getByRole('textbox', { name: `Số hợp đồng ghế ${n}` })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Số hợp đồng ghế 1' }), 'PO-1');
    await user.click(screen.getByRole('button', { name: 'Chép số hợp đồng của ghế 1 xuống các ghế còn lại' }));
    expect(screen.getByRole('textbox', { name: 'Số hợp đồng ghế 3' })).toHaveValue('PO-1');
    await user.type(screen.getByRole('textbox', { name: 'Ghi chú ghế 2' }), 'key dán thân máy');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      seatTotal: 3,
      perSeat: true,
      seats: [
        { seatNo: 1, contract: 'PO-1', note: '' },
        { seatNo: 2, contract: 'PO-1', note: 'key dán thân máy' },
        { seatNo: 3, contract: 'PO-1', note: '' },
      ],
    });
  });

  it('bớt xuống 1 ghế thì tick tự tắt, bảng ghế biến mất', async () => {
    mockFetch();
    render();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Số ghế' }), '2');
    await user.click(screen.getByRole('checkbox', { name: /^Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng/ }));
    expect(screen.getByRole('textbox', { name: 'Số hợp đồng ghế 2' })).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Số ghế' }));
    await user.type(screen.getByRole('textbox', { name: 'Số ghế' }), '1');
    expect(screen.getByRole('checkbox', { name: /^Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng/ })).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Số hợp đồng ghế 1' })).toBeNull();
  });

  it('ghi chú ghế trông như mật khẩu: báo tại ô, không gửi', async () => {
    const writes = mockFetch();
    render();
    const user = userEvent.setup();
    await fillRequired(user);
    await user.type(screen.getByRole('textbox', { name: 'Số ghế' }), '2');
    await user.click(screen.getByRole('checkbox', { name: /^Mỗi ghế có hợp đồng, giấy tờ và ghi chú riêng/ }));
    await user.type(screen.getByRole('textbox', { name: 'Ghi chú ghế 1' }), 'mk admin Pmh@Server2026');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ghi chú ghế 1' })).toHaveAttribute('aria-invalid', 'true'));
    expect(writes).toHaveLength(0);
  });

  it('"Lưu rồi gán vào máy" báo nơi gọi mở hộp Gán của hồ sơ vừa tạo', async () => {
    mockFetch();
    const onSaved = vi.fn();
    render({ onSaved });
    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Lưu rồi gán vào máy' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'new1', assign: true }));
  });

  it('Mua thêm đợt mới: điền sẵn theo đợt trước, kể các đợt đã có, gợi ý mã không trùng', async () => {
    mockFetch();
    render({ batchFrom: WIN25 });
    expect(screen.getByRole('dialog', { name: 'Mua thêm đợt mới — Windows Server 2025' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tên hồ sơ' })).toHaveValue('Windows Server 2025');
    expect(screen.getByRole('radio', { name: 'Vĩnh viễn' })).toBeChecked();
    const note = await screen.findByRole('note');
    await waitFor(() => expect(note).toHaveTextContent('LIC-WIN25-02 (3)'));
    await userEvent.setup().click(within(note).getByRole('button', { name: 'Dùng mã LIC-WIN25-03' }));
    expect(screen.getByRole('textbox', { name: 'Mã hồ sơ' })).toHaveValue('LIC-WIN25-03');
    // Đợt đã thanh lý vẫn giữ mã: hỏi KHÔNG lọc trạng thái (API đọc chữ lạ như `all` thành "trừ thanh lý").
    const siblingCall = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find((url) => url.startsWith('/api/v1/software?'));
    expect(siblingCall).not.toMatch(/[?&]status=/);
  });

  it('Sửa hồ sơ ghế riêng: chưa đọc được ghế đã lưu thì KHÔNG gửi ghế (không xoá trắng hợp đồng đã lưu)', async () => {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          writes.push(JSON.parse(String(init.body)));
          return Promise.resolve(jsonResponse(200, { id: 'w1' }));
        }
        if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
        if (url.startsWith('/api/v1/software/w1')) return Promise.resolve(jsonResponse(500, { message: 'hỏng' }));
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    render({ row: { ...WIN25, perSeat: true, seatUsed: 0 } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ perSeat: true });
    expect(writes[0].seats ?? []).toEqual([]);
  });

  it('Sửa hồ sơ ghế riêng: chỉ gửi đúng ô vừa sửa, ô khác giữ giá trị đã lưu ở server', async () => {
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          writes.push(JSON.parse(String(init.body)));
          return Promise.resolve(jsonResponse(200, { id: 'w1' }));
        }
        if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
        if (url.startsWith('/api/v1/software/w1')) {
          return Promise.resolve(
            jsonResponse(200, {
              ...WIN25,
              perSeat: true,
              seats: [
                { id: 's1', seatNo: 1, contract: 'PO-A', note: null, assignmentId: null, deviceId: null },
                { id: 's2', seatNo: 2, contract: 'PO-B', note: 'cũ', assignmentId: null, deviceId: null },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    render({ row: { ...WIN25, perSeat: true, seatUsed: 0 } });
    const user = userEvent.setup();
    const note2 = await screen.findByRole('textbox', { name: 'Ghi chú ghế 2' });
    await waitFor(() => expect(note2).toHaveValue('cũ'));
    expect(screen.getByRole('textbox', { name: 'Số hợp đồng ghế 1' })).toHaveValue('PO-A');
    await user.clear(note2);
    await user.type(note2, 'mới');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].seats).toEqual([{ seatNo: 2, note: 'mới' }]);
  });

});

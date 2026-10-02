import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { SoftwareForm } from './software-form';
import type { SoftwareRow } from './software-types';

afterEach(() => vi.unstubAllGlobals());

const CATALOG = { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] };

const ROW: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-FORM',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 5,
  seatUsed: 0,
  startDate: '2024-02-29',
  endDate: '2024-12-31',
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
        return Promise.resolve(jsonResponse(200, { id: 'sw1' }));
      }
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return writes;
}

function render(row: SoftwareRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <SoftwareForm row={row} csrfToken="csrf" onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );
}

describe('Form hồ sơ phần mềm', () => {
  it('hộp tạo mới mang tên "Thêm phần mềm"', () => {
    mockFetch();
    render(null);
    expect(screen.getByRole('dialog', { name: 'Thêm phần mềm' })).toBeInTheDocument();
  });

  it('câu giải thích kỳ hạn nằm sau nút (i), không in thẳng dưới ô', async () => {
    mockFetch();
    render(null);
    expect(screen.queryByText(/hệ thống nhắc gia hạn/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Giải thích: Kỳ hạn' }));
    expect(screen.getByText(/hệ thống nhắc gia hạn/)).toBeInTheDocument();
  });

  it('+1 năm tính từ ngày bắt đầu (29/02 lùi về 28/02); chưa có ngày bắt đầu thì tắt', async () => {
    mockFetch();
    const { unmount } = render(null);
    expect(screen.getByRole('button', { name: '+1 năm' })).toBeDisabled();
    unmount();

    const writes = mockFetch();
    render(ROW);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ startDate: '2024-02-29', endDate: '2025-02-28' });
  });

  it('Ghế và Ghi chú chung một khu — không còn khu "Ghế" riêng', () => {
    mockFetch();
    render(null);
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).not.toContain('Ghế');
    expect(screen.getByRole('textbox', { name: 'Số ghế' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('SỬA: lời nhắc "lưu ngay" của giấy tờ nằm sau nút (i) cạnh tiêu đề khu', async () => {
    mockFetch();
    render(ROW);
    expect(screen.queryByText('Tải lên / xóa ở đây được lưu ngay, không cần bấm Lưu.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' }));
    expect(
      screen.getByText('Tải lên / xóa ở đây được lưu ngay, không cần bấm Lưu.'),
    ).toBeInTheDocument();
  });
});

/** Form mở từ màn nào thì chỉ cho chọn loại của màn đó (Q-22). */
describe('Form theo màn (Q-22)', () => {
  function renderOn(screenKey: 'software' | 'domains' | 'maintenance' | 'services') {
    return renderWithI18n(
      <ToastProvider>
        <SoftwareForm row={null} screen={screenKey} csrfToken="csrf" onClose={() => {}} onSaved={() => {}} />
      </ToastProvider>,
    );
  }

  it('Tên miền & SSL: hai lựa chọn Tên miền / Chứng chỉ SSL, tiêu đề "Thêm tên miền / SSL"', () => {
    mockFetch();
    renderOn('domains');
    expect(screen.getByRole('dialog', { name: 'Thêm tên miền / SSL' })).toBeInTheDocument();
    const kinds = within(screen.getByRole('radiogroup', { name: 'Loại' }))
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
    expect(kinds).toEqual(['Tên miền', 'Chứng chỉ SSL']);
    // Không còn ô của license.
    expect(screen.queryByRole('textbox', { name: 'Số ghế' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Kỳ hạn' })).toBeNull();
  });

  it('Tên miền & SSL: phải có ít nhất một tên miền — ô "Tên miền" báo lỗi, không gửi', async () => {
    const writes = mockFetch();
    renderOn('domains');
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Mã hồ sơ/ }), 'DOM-E2E-1');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Tên miền chính');
    expect(screen.getByText(/một hoặc nhiều tên miền dùng chung ngày hết hạn này/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findAllByText('Nhập ít nhất một tên miền.')).not.toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['maintenance', 'Thêm hợp đồng bảo trì', 'maintenance'],
    ['services', 'Thêm dịch vụ', 'other'],
    ['software', 'Thêm phần mềm', 'license'],
  ] as const)('%s (%s): loại cố định, không có ô chọn Loại, gửi kind=%s', async (key, title, kind) => {
    const writes = mockFetch();
    renderOn(key);
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Loại' })).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Mã hồ sơ/ }), 'X-E2E-1');
    await user.type(screen.getByRole('textbox', { name: /Tên hồ sơ/ }), 'Hồ sơ thử');
    if (kind === 'license') {
      await user.click(screen.getByRole('radio', { name: 'Vĩnh viễn' }));
    }
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ kind });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DeviceRow } from '@/lib/device-types';
import { DeviceForm } from './device-form';

/**
 * DEV-025 + DEV-027 trên form thật.
 *
 *   · bấm Lưu khi trống: câu tiếng Việt dưới từng ô bắt buộc, tóm tắt đầu form, tiêu điểm về
 *     ô đầu tiên, KHÔNG gửi gì — thay cho bong bóng "Please fill out this field." (form đặt
 *     `noValidate`, nên thiếu hook là form gửi thẳng lên server);
 *   · ô chọn danh mục chỉ mời mục còn dùng; hồ sơ đang trỏ vào mục đã vô hiệu vẫn thấy đúng tên.
 */

const LISTS = {
  sites: [
    { id: 's-on', code: 'HCM', name: 'Văn phòng', address: null, active: true },
    { id: 's-off', code: 'KHO-CU', name: 'Kho cũ', address: null, active: false },
  ],
  cabinets: [],
  deviceTypes: [
    { id: 't-on', name: 'PC', hasPortMap: false, description: null, active: true },
    { id: 't-off', name: 'Máy fax', hasPortMap: false, description: null, active: false },
  ],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

function mockFetch() {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm(device: DeviceRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm device={device} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Form thiết bị — kiểm tiếng Việt và danh mục vô hiệu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bấm Lưu khi trống: lỗi dưới từng ô, tóm tắt, tiêu điểm ô đầu, không gửi', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Còn 3 ô cần sửa trước khi lưu.')).toBeInTheDocument();
    const code = screen.getByRole('textbox', { name: 'Mã thiết bị' });
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription('Bắt buộc — chưa nhập ô này.');
    expect(screen.getByRole('button', { name: 'Loại' })).toHaveAccessibleDescription(
      'Bắt buộc — chưa chọn ô này.',
    );
    await waitFor(() => expect(code).toHaveFocus());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ghi chú có chuỗi trông như mật khẩu: báo tại ô, không gửi (Q-19)', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    const note = screen.getByRole('textbox', { name: 'Ghi chú' });
    await user.type(note, 'mk wifi Pmh@Guest2026');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(note).toHaveAttribute('aria-invalid', 'true'));
    expect(note).toHaveAccessibleDescription(expect.stringContaining('trông như mật khẩu'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('thêm mới: loại và site đã vô hiệu không có trong ô chọn', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/catalog'))).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Loại' }));
    expect(await screen.findByRole('option', { name: 'PC' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Máy fax/ })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Site' }));
    expect(await screen.findByRole('option', { name: /HCM/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /KHO-CU/ })).toBeNull();
  });

  it('hồ sơ đang trỏ vào loại đã vô hiệu vẫn hiện đúng tên, kèm "(ngừng dùng)"', async () => {
    mockFetch();
    renderForm({
      id: 'd1',
      code: 'FAX-01',
      name: 'Máy fax tầng 2',
      deviceTypeId: 't-off',
      siteId: 's-off',
      status: 'in_use',
    } as DeviceRow);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Loại' })).toHaveTextContent(
        'Máy fax (ngừng dùng)',
      ),
    );
    expect(screen.getByRole('button', { name: 'Site' })).toHaveTextContent(/KHO-CU.*\(ngừng dùng\)/);
  });

  it('sửa: "giấy tờ lưu ngay" nằm trong nút (i) cạnh tiêu đề khu, không phải băng cảnh báo', async () => {
    mockFetch();
    renderForm({ id: 'd1', code: 'PC-01', name: 'Máy', deviceTypeId: 't-on', status: 'in_use' } as DeviceRow);
    const user = userEvent.setup();
    expect(screen.queryByText(/có hiệu lực ngay/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Giải thích: Giấy tờ đính kèm' }));
    expect(
      await screen.findByText('Tải lên / xóa ở đây được lưu ngay, không cần bấm Lưu.'),
    ).toBeInTheDocument();
  });

  it('Vị trí và Mua sắm & bảo hành xếp 4 cột; ghi chú 2 dòng', () => {
    mockFetch();
    renderForm(null);
    for (const heading of ['Vị trí và người giữ', 'Mua sắm và bảo hành']) {
      const section = screen.getByRole('heading', { name: heading }).closest('section');
      expect(section?.querySelector('.form-grid')).toHaveAttribute('data-columns', '4');
    }
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveAttribute('rows', '2');
  });
});

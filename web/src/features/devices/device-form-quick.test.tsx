import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DeviceRow } from '@/lib/device-types';
import { DeviceForm } from './device-form';

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [{ id: 't1', name: 'Laptop', hasPortMap: false, description: null, active: true }],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

const SOURCE = {
  id: 'd1',
  code: 'LT-01',
  name: 'Laptop Dell',
  deviceTypeId: 't1',
  model: 'Latitude 5440',
  serial: 'SN-1',
  assignedTo: 'An',
  department: 'Kế toán',
  purchaseDate: '2025-03-15',
  warrantyStart: '2025-03-15',
  warrantyEnd: '2028-03-15',
  note: 'riêng máy này',
  status: 'broken',
} as DeviceRow;

function mockFetch() {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return Promise.resolve(
          jsonResponse(201, { device: { ...SOURCE, ...body, id: 'new' }, warnings: [] }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return posts;
}

function render(props: Partial<Parameters<typeof DeviceForm>[0]>) {
  const onSaved = vi.fn();
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm device={null} csrfToken="t" onClose={() => {}} onSaved={onSaved} {...props} />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return { onSaved };
}

describe('Form thiết bị — khai nhanh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('SỬA: ô Trạng thái không mời "Đã thanh lý" (API luôn từ chối đường này)', async () => {
    mockFetch();
    render({ device: SOURCE });
    await userEvent.click(screen.getByRole('button', { name: 'Trạng thái' }));
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Đang dùng', 'Dự phòng', 'Hỏng']);
  });

  it('NHÂN BẢN: điền sẵn mọi ô trừ mã, serial, người dùng, ghi chú', async () => {
    mockFetch();
    render({ cloneFrom: SOURCE });
    expect(screen.getByRole('dialog', { name: 'Nhân bản từ LT-01' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tên thiết bị' })).toHaveValue('Laptop Dell');
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('Latitude 5440');
    expect(screen.getByRole('textbox', { name: 'Mã thiết bị' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Serial' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Người sử dụng' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveValue('');
  });

  it('+2 năm tính từ Bảo hành từ; "Lưu và nhân bản" giữ phần chung, làm trống phần riêng', async () => {
    const posts = mockFetch();
    const { onSaved } = render({ cloneFrom: SOURCE });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+2 năm' }));
    await user.type(screen.getByRole('textbox', { name: 'Mã thiết bị' }), 'LT-02');
    await user.click(screen.getByRole('button', { name: 'Lưu và nhân bản' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posts[0]).toMatchObject({ code: 'LT-02', warrantyEnd: '2027-03-15', status: 'in_use' });
    expect(onSaved.mock.calls[0][1]).toEqual({ keepOpen: true });
    expect(screen.getByRole('textbox', { name: 'Mã thiết bị' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('Latitude 5440');
  });
});

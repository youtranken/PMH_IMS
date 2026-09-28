import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { IspForm } from './isp-form';
import type { IspRow } from './isp-types';

/**
 * OLD-DB-01 (QUYET-DINH Q-11) — nhà mạng CHỌN từ danh mục, gửi đi bằng id.
 *
 * Ô gõ tự do có gợi ý để lọt "fpt " bên cạnh "FPT", và đổi tên trong danh mục không tới được hồ
 * sơ nào. Bài này giữ ba điều: ô là ô CHỌN (không gõ được), mục ngừng dùng không mời chọn mới,
 * và thứ đi lên server là `providerId` chứ không phải chữ.
 */

const PROVIDERS = [
  { id: 'p-fpt', name: 'FPT Telecom', hotline: null, contact: null, active: true },
  { id: 'p-vnpt', name: 'VNPT', hotline: null, contact: null, active: true },
  { id: 'p-cu', name: 'Nhà mạng cũ', hotline: null, contact: null, active: false },
];

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [],
  vendors: [],
  departments: [],
  ispProviders: PROVIDERS,
  servicePorts: [],
};

function mockFetch() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, { id: 'new-id' }));
    }),
  );
  return calls;
}

function renderForm(row: IspRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <IspForm row={row} csrfToken="t" onClose={() => undefined} onSaved={() => undefined} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const ROW_ON_INACTIVE = {
  id: 'line-1',
  code: 'ISP-CU',
  provider: 'Nhà mạng cũ',
  providerId: 'p-cu',
  bandwidth: null,
  wanIp: null,
  siteId: null,
  siteCode: null,
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  hotline: null,
  contractNo: null,
  startDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
} as IspRow;

describe('Form đường truyền — nhà mạng chọn từ danh mục', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ô Nhà mạng là ô chọn, chỉ mời mục đang dùng; lưu gửi providerId', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();

    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    expect(picker).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('combobox', { name: 'Nhà mạng' })).toBeNull();

    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/catalog'))).toBe(true));
    await user.click(picker);
    expect(await screen.findByRole('option', { name: 'FPT Telecom' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Nhà mạng cũ/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'VNPT' }));

    await user.type(screen.getByLabelText(/Mã đường/), 'ISP-E2E-01');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/isp-lines')).toBe(true));
    const body = calls.find((c) => c.url === '/api/v1/isp-lines')!.body as Record<string, unknown>;
    expect(body.providerId).toBe('p-vnpt');
    expect(body).not.toHaveProperty('provider');
  });

  it('chưa chọn nhà mạng → báo lỗi, không gửi', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Mã đường/), 'ISP-E2E-02');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    // Câu lỗi nằm DƯỚI ô Nhà mạng và nối vào chính ô đó, không phải một khối chung đầu form.
    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    await waitFor(() => expect(picker).toHaveAttribute('aria-invalid', 'true'));
    expect(picker).toHaveAccessibleDescription(/chưa chọn ô này/);
    expect(calls.some((c) => c.url === '/api/v1/isp-lines')).toBe(false);
  });

  it('hồ sơ đang trỏ vào mục ngừng dùng vẫn hiện đúng mục đó', async () => {
    mockFetch();
    renderForm(ROW_ON_INACTIVE);
    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    await waitFor(() => expect(picker).toHaveTextContent(/Nhà mạng cũ \(ngừng dùng\)/));
  });

  it('đổi sang Đã thanh lý thì hỏi lại, nút xác nhận là HÀNH ĐỘNG "Thanh lý" (Q-14)', async () => {
    mockFetch();
    renderForm(ROW_ON_INACTIVE);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Trạng thái' }));
    await user.click(await screen.findByRole('option', { name: 'Đã thanh lý' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const ask = await screen.findByRole('dialog', { name: /^Thanh lý đường truyền ISP-CU/ });
    expect(within(ask).getByRole('button', { name: 'Thanh lý' })).toBeInTheDocument();
    expect(within(ask).queryByRole('button', { name: 'Đã thanh lý' })).toBeNull();
  });
});

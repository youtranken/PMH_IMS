import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { DeviceIpAssign } from './device-ip-assign';

/**
 * DEV-089: cấp IP ngay từ trang thiết bị — chọn dải, IP trống đầu tiên (bỏ gateway) điền sẵn,
 * bước sau là hộp Cấp IP dùng chung với máy đang xem đã điền.
 */

afterEach(() => vi.unstubAllGlobals());

const SUBNET = {
  id: 'sub-1',
  name: 'LAN E2E',
  cidr: '10.77.1.0/29',
  vlan: 10,
  gateway: '10.77.1.1',
  free: 5,
};

function mockFetch() {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url === '/api/v1/ipam/subnets') return Promise.resolve(jsonResponse(200, [SUBNET]));
      if (url.startsWith('/api/v1/ipam/subnets/sub-1/addresses')) {
        return Promise.resolve(
          jsonResponse(200, [
            { kind: 'free', address: '10.77.1.1' },
            { kind: 'free', address: '10.77.1.2' },
            { kind: 'free', address: '10.77.1.3' },
          ]),
        );
      }
      if (url === '/api/v1/ipam/devices/dev-1/addresses') {
        return Promise.resolve(
          jsonResponse(200, [{ id: 'ip-old', address: '10.9.9.5', status: 'assigned', deviceId: 'dev-1' }]),
        );
      }
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { departments: [] }));
      }
      return Promise.resolve(jsonResponse(201, {}));
    }),
  );
  return calls;
}

describe('DeviceIpAssign', () => {
  it('chưa chọn dải thì báo lỗi dưới ô, không sang bước sau', async () => {
    mockFetch();
    renderWithI18n(
      <ToastProvider>
        <DeviceIpAssign device={{ id: 'dev-1', code: 'PC-E2E-1' }} csrfToken="t" onClose={vi.fn()} onDone={vi.fn()} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(screen.getByText('Chọn dải mạng để lấy IP.')).toBeInTheDocument();
  });

  it('chọn dải → IP trống đầu tiên KHÔNG phải gateway; cấp đi với máy đang xem', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DeviceIpAssign device={{ id: 'dev-1', code: 'PC-E2E-1' }} csrfToken="t" onClose={vi.fn()} onDone={onDone} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dải mạng' }));
    await userEvent.click(await screen.findByRole('option', { name: /LAN E2E/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'IP trống' })).toHaveTextContent('10.77.1.2'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    expect(await screen.findByRole('dialog', { name: 'Cấp IP — 10.77.1.2' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Thiết bị' })).toHaveValue('PC-E2E-1');
    await userEvent.click(screen.getByRole('button', { name: 'Cấp IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.url).toBe('/api/v1/ipam/addresses');
    expect(post?.body).toMatchObject({ subnetId: 'sub-1', address: '10.77.1.2', deviceId: 'dev-1' });
  });

  it('Q-20 Đổi IP: hộp nói IP hiện tại, máy cố định, gửi một lượt đổi chứ không cấp thêm', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DeviceIpAssign change device={{ id: 'dev-1', code: 'PC-E2E-1' }} csrfToken="t" onClose={vi.fn()} onDone={onDone} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Đổi IP cho PC-E2E-1' })).toBeInTheDocument();
    expect(await screen.findByText('10.9.9.5')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dải mạng' }));
    await userEvent.click(await screen.findByRole('option', { name: /LAN E2E/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'IP trống' })).toHaveTextContent('10.77.1.2'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    expect(await screen.findByRole('dialog', { name: 'Đổi IP — 10.77.1.2' })).toBeInTheDocument();
    // Máy không đổi được trong hộp Đổi IP — chỉ địa chỉ đổi.
    expect(screen.queryByRole('combobox', { name: 'Thiết bị' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Đổi IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.url).toBe('/api/v1/ipam/addresses/ip-old/change');
    expect(post?.body).toMatchObject({ subnetId: 'sub-1', address: '10.77.1.2' });
    expect(post?.body).not.toHaveProperty('deviceId');
  });

  it('đường hỏng: chưa có dải nào thì không bày ô chọn rỗng — chỉ lối sang khai dải', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(jsonResponse(200, url === '/api/v1/ipam/subnets' ? [] : {})),
      ),
    );
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <DeviceIpAssign device={{ id: 'dev-1', code: 'PC-E2E-1' }} csrfToken="t" onClose={vi.fn()} onDone={vi.fn()} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Chưa có dải mạng nào để cấp IP.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Khai dải mạng' })).toHaveAttribute('href', '/ip-addresses');
    expect(screen.queryByRole('button', { name: 'Dải mạng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tiếp tục' })).toBeNull();
  });
});

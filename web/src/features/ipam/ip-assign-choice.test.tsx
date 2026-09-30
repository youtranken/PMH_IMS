import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { AssignIpDialog } from './ip-assign-dialog';
import type { IpRow } from './ipam-types';

/**
 * NET-007: "Cấp IP trống kế tiếp" điền sẵn chỗ trống nhỏ nhất, nhưng người cắm máy hay có một
 * địa chỉ quen tay — đổi ngay trong hộp, không phải đóng hộp đi dò lại bảng.
 * NET-031: ô Thiết bị nói máy nào ĐÃ có IP, để khỏi cấp hai địa chỉ cho một máy.
 */

const FREE_RECORD: IpRow = {
  id: 'ip-9',
  subnetId: 'sub-1',
  address: '10.77.1.9',
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  usedBy: null,
  assignedBy: 'e2e',
  assignedAt: null,
  status: 'free',
  note: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
} as unknown as IpRow;

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
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { departments: [] }));
      }
      if (url.startsWith('/api/v1/devices?')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              { id: 'd-1', code: 'PC-E2E-01', name: 'Máy kế toán' },
              { id: 'd-2', code: 'PC-E2E-02', name: 'Máy kho' },
            ],
          }),
        );
      }
      if (url.startsWith('/api/v1/ipam/devices/addresses')) {
        return Promise.resolve(jsonResponse(200, { 'd-1': ['10.77.1.3'] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  return calls;
}

function renderDialog(onDone = vi.fn()) {
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <AssignIpDialog
          subnetId="sub-1"
          address="10.77.1.2"
          record={null}
          choices={[
            { address: '10.77.1.2', record: null },
            { address: '10.77.1.4', record: null },
            { address: '10.77.1.9', record: FREE_RECORD },
          ]}
          csrfToken="t"
          onClose={() => {}}
          onDone={onDone}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return onDone;
}

describe('Hộp Cấp IP — đổi địa chỉ, cảnh báo máy đã có IP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đổi sang ô trống khác: POST đúng địa chỉ mới, onDone nhận địa chỉ đó', async () => {
    const calls = mockFetch();
    const onDone = renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Địa chỉ' }));
    await user.click(screen.getByRole('option', { name: '10.77.1.4' }));
    expect(screen.getByRole('dialog', { name: 'Cấp IP — 10.77.1.4' })).toBeVisible();
    await user.type(screen.getByRole('combobox', { name: 'Người / phòng ban dùng' }), 'Kho');
    await user.click(screen.getByRole('button', { name: 'Cấp IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('10.77.1.4'));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ address: '10.77.1.4' });
  });

  it('đổi sang hồ sơ Trống: đi đường transition của hồ sơ đó', async () => {
    const calls = mockFetch();
    const onDone = renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Địa chỉ' }));
    await user.click(screen.getByRole('option', { name: /10\.77\.1\.9/ }));
    await user.type(screen.getByRole('combobox', { name: 'Người / phòng ban dùng' }), 'Kho');
    await user.click(screen.getByRole('button', { name: 'Cấp IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('10.77.1.9'));
    expect(calls.find((c) => c.method === 'POST')?.url).toBe(
      '/api/v1/ipam/addresses/ip-9/transition',
    );
  });

  it('danh sách máy ghi "đang có IP" cho máy đã giữ địa chỉ', async () => {
    mockFetch();
    renderDialog();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Thiết bị' }));
    const option = await screen.findByRole('option', { name: /PC-E2E-01/ });
    await waitFor(() => expect(option).toHaveTextContent('đang có 10.77.1.3'));
    expect(screen.getByRole('option', { name: /PC-E2E-02/ })).not.toHaveTextContent('đang có');
  });
});

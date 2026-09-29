import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within, jsonResponse } from '@/test/test-utils';
import i18n from '@/lib/i18n';
import type { DeviceRow } from '@/lib/device-types';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { PortMapPanel } from './port-map-panel';

const DEVICE = { id: 'd-1', code: 'SW-E2E-01', name: 'Switch', status: 'in_use' } as DeviceRow;

const PORTS = {
  ports: [
    {
      id: 'p-1',
      portLabel: 'Gi1/0/1',
      connectedDeviceId: 'd-2',
      connectedDeviceCode: 'SV-E2E-AD-01',
      connectedDeviceName: 'Máy chủ AD',
      connectedLabel: null,
      connectedPort: 'NIC1',
      usedBy: 'Máy chủ AD / DNS',
      vlan: '20',
      note: null,
    },
  ],
  incoming: [],
};

function renderAt(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, PORTS))));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ToastProvider>
            <ConfirmProvider>
              <PortMapPanel device={DEVICE} csrfToken="t" canEdit />
            </ConfirmProvider>
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Điện thoại: một cổng là thẻ hai dòng, không phải thẻ bảy dòng nhãn–giá trị. */
describe('PortMapPanel — thẻ cổng trên điện thoại', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('màn hẹp: dòng 1 "cổng → máy : cổng đầu kia", dòng 2 "VLAN · người dùng", có ⋯', async () => {
    renderAt(true);
    const list = await screen.findByRole('list', { name: 'Cổng của thiết bị này' });
    const card = within(list).getByRole('listitem');
    expect(card).toHaveTextContent('Gi1/0/1 → SV-E2E-AD-01 : NIC1');
    expect(card).toHaveTextContent('VLAN 20 · Máy chủ AD / DNS');
    expect(within(card).getByRole('button', { name: /Thao tác với Gi1\/0\/1/ })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('màn rộng: vẫn là bảng', async () => {
    renderAt(false);
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

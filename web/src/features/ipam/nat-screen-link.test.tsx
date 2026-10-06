import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { NatScreen } from './nat-screen';

/** X-05: link thẳng tới MỘT luật NAT (`/nat?rule=<id>`) — dán vào biên bản sự cố được. */

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

function rule(id: string, port: string) {
  return {
    id,
    deviceId: 'fw',
    deviceCode: 'FW-E2E-01',
    deviceName: 'Tường lửa',
    siteCode: 'HQ',
    protocol: 'tcp',
    externalPorts: port,
    internalIp: '10.0.0.5',
    internalPort: 443,
    ipAddressId: null,
    internalOwner: null,
    internalDeviceId: null,
    internalDeviceCode: null,
    usedBy: 'Kế toán',
    reason: `Lý do ${port}`,
    enabled: true,
    note: null,
    createdBy: 'sa@pmh.com.vn',
    createdAt: '2026-10-01T00:00:00Z',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
}

function render(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/ipam/nat?')) return Promise.resolve(jsonResponse(200, [rule('r1', '8080'), rule('r2', '8443')]));
      if (url.startsWith('/api/v1/isp-lines')) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.startsWith('/api/v1/ipam/settings')) return Promise.resolve(jsonResponse(200, { natSensitivePorts: [22], natWidePortRange: 1000, subnetMinPrefix: 24 }));
      return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], servicePorts: [] }));
    }),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <NatScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Sổ NAT — link tới một luật (X-05)', () => {
  it('?rule=<id> tô sáng đúng dòng đó (aria-current)', async () => {
    render('/nat?rule=r2');
    const row = (await screen.findByText('Lý do 8443')).closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('aria-current', 'true');
    expect((screen.getByText('Lý do 8080').closest('tr') as HTMLElement)).not.toHaveAttribute('aria-current');
  });

  it('menu dòng có "Sao chép link" — chép đường /nat?rule=<id>', async () => {
    render('/nat');
    const row = (await screen.findByText('Lý do 8080')).closest('tr') as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: /^Thao tác với/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sao chép link' }));
    // user-event gắn bộ nhớ tạm giả của nó: đọc lại đúng thứ đã chép.
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/nat?rule=r1`);
  });

  it('?rule= không có trong bảng đang xem: nói rõ, có nút bỏ lọc', async () => {
    render('/nat?rule=khong-co&search=8080');
    expect(await screen.findByText(/Luật NAT trong link không nằm trong bảng đang xem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ lọc để thấy luật này' })).toBeInTheDocument();
  });
});

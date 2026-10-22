import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { NatScreen } from './nat-screen';

/** UX-E40 (Q-33): huy hiệu "Đã gỡ" ngắn (chi tiết vào title) và chip trạng thái nằm trên URL. */

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

const voided = {
  ...rule('r3', '9090'),
  voidedAt: '2026-10-05T00:00:00Z',
  voidedBy: 'sa@pmh.com.vn',
  voidReason: 'dịch vụ đã ngừng',
};

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function render(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/ipam/nat?')) return Promise.resolve(jsonResponse(200, [rule('r1', '8080'), rule('r2', '8443'), voided]));
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
          <Where />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Sổ NAT — huy hiệu ngắn + chip trên URL (UX-E40)', () => {
  it('bật chip "Đã gỡ" ghi lên URL; mở lại link đó thì chip vẫn bật', async () => {
    render('/nat');
    await screen.findByText('Lý do 8080');
    expect(screen.queryByText('Lý do 9090')).toBeNull();
    const group = screen.getByRole('group', { name: 'Lọc theo trạng thái luật' });
    await userEvent.click(within(group).getByRole('button', { name: /^Đã gỡ/ }));
    expect(await screen.findByText('Lý do 9090')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toContain('states=open%2Cvoided');
  });

  it('?states=voided chỉ hiện luật đã gỡ; huy hiệu chỉ "Đã gỡ", ngày · người · lý do nằm ở title', async () => {
    render('/nat?states=voided');
    const row = (await screen.findByText('Lý do 9090')).closest('tr') as HTMLElement;
    expect(screen.queryByText('Lý do 8080')).toBeNull();
    const badge = within(row).getByText('Đã gỡ', { selector: '.badge' });
    expect(badge.getAttribute('title')).toMatch(/05\/10\/2026 · sa@pmh\.com\.vn · dịch vụ đã ngừng/);
  });
});

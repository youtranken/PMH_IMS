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

// UX-E29: file xuất theo đúng bộ lọc đang bày — giao thức, cổng nhạy cảm, chip trạng thái, thứ tự.
describe('Sổ NAT — Xuất Excel theo bộ lọc', () => {
  it('URL xuất mang protocol, sensitive, states (chip đang bật) và sort', async () => {
    render('/nat?protocol=udp&sensitive=1&sort=newest');
    const fetchMock = fetch as unknown as { mock: { calls: [RequestInfo | URL][] } };
    // Bộ lọc này không ra dòng nào (hai rule đều TCP) — chờ sổ về rồi mới bấm Xuất.
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/v1/ipam/nat?'))).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: /Xuất Excel/ }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/v1/ipam/nat/export.xlsx'))).toBe(true));
    const call = fetchMock.mock.calls.find(([u]) => String(u).startsWith('/api/v1/ipam/nat/export.xlsx'))!;
    const params = new URL(String(call[0]), 'http://x').searchParams;
    expect(params.get('protocol')).toBe('udp');
    expect(params.get('sensitive')).toBe('1');
    expect(params.get('states')).toBe('open');
    expect(params.get('sort')).toBe('newest');
  });
});

// UX-E25: dừng một máy chủ có chục luật NAT — tick nhiều luật, gỡ một lượt, một lý do.
describe('Sổ NAT — gỡ nhiều luật', () => {
  it('SA tick hai luật → "Gỡ 2 luật" → một lý do → một lượt POST /ipam/nat/bulk-void', async () => {
    render('/nat');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /^Chọn TCP 8080/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Chọn TCP 8443/ }));
    const bar = screen.getByRole('group', { name: 'Thao tác với các luật đã chọn' });
    expect(bar).toHaveTextContent('Đã chọn 2');
    await user.click(within(bar).getByRole('button', { name: 'Gỡ 2 luật' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ 2 luật NAT' });
    const fetchMock = fetch as unknown as { mock: { calls: [RequestInfo | URL, RequestInit | undefined][] } };
    fetchMock.mock.calls.length = 0;
    await user.type(within(dialog).getByRole('textbox', { name: /Lý do/ }), 'Máy chủ camera ngừng');
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ' }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u, init]) => String(u) === '/api/v1/ipam/nat/bulk-void' && init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([u]) => String(u) === '/api/v1/ipam/nat/bulk-void')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ ids: ['r1', 'r2'], reason: 'Máy chủ camera ngừng' });
  });
});

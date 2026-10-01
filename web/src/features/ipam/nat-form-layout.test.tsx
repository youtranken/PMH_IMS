import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';
import { NatScreen } from './nat-screen';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const RULE = {
  id: 'r1',
  deviceId: 'd-fw',
  deviceCode: 'FW-01',
  deviceName: 'Draytek',
  siteCode: 'HCM',
  protocol: 'tcp',
  externalPorts: '8080',
  internalIp: '172.16.10.5',
  internalPort: 80,
  ipAddressId: null,
  internalOwner: null,
  internalDeviceId: null,
  internalDeviceCode: null,
  usedBy: 'IT',
  reason: 'Web nội bộ',
  enabled: true,
  note: null,
  createdBy: 'sa@pmh.com.vn',
  createdAt: '2026-01-01T00:00:00Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

function mockFetch(rules: unknown[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/v1/ipam/nat?')) return Promise.resolve(jsonResponse(200, rules));
      if (url.startsWith('/api/v1/ipam/settings')) {
        return Promise.resolve(
          jsonResponse(200, {
            subnetFullPercent: 80,
            natSensitivePorts: [22],
            subnetMinPrefix: 24,
            natWidePortRange: 1000,
          }),
        );
      }
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(
          jsonResponse(200, {
            sites: [],
            cabinets: [],
            deviceTypes: [],
            vendors: [],
            departments: [],
            ispProviders: [],
            servicePorts: [],
          }),
        );
      }
      if (url.startsWith('/api/v1/isp-lines') || url.startsWith('/api/v1/devices')) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return urls;
}

function renderScreen() {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <NatScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Hộp Sửa luật NAT', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đủ rộng để xếp 4 cột, khối "Vì sao mở" không còn dây dọc', async () => {
    mockFetch([]);
    const user = userEvent.setup();
    renderScreen();
    await user.click((await screen.findAllByRole('button', { name: 'Thêm luật NAT' }))[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveStyle({ maxWidth: '960px' });
    const grids = Array.from(dialog.querySelectorAll('.form-grid')).map((grid) =>
      grid.getAttribute('data-columns'),
    );
    expect(grids[0]).toBe('4');
    expect(grids[2]).toBe('4');
  });

  it('gợi ý dài của Cổng ngoài, Máy đích, Ghi chú nằm sau nút (i)', async () => {
    mockFetch([]);
    const user = userEvent.setup();
    renderScreen();
    await user.click((await screen.findAllByRole('button', { name: 'Thêm luật NAT' }))[0]);
    const dialog = await screen.findByRole('dialog');
    for (const label of ['Cổng ngoài', 'Máy đích (được NAT)', 'Ghi chú']) {
      expect(within(dialog).getByRole('button', { name: `Giải thích: ${label}` })).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(/Mỗi khoảng thành một dòng trong sổ/)).toBeNull();
    expect(within(dialog).queryByText(/Chọn máy thì ô IP chỉ còn IP/)).toBeNull();
    expect(within(dialog).queryByText(/số phiếu yêu cầu/)).toBeNull();
  });

  it('không nhúng Lịch sử — menu ⋮ của dòng đã có mục đó', async () => {
    const urls = mockFetch([RULE]);
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: /Thao tác với/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Giấy tờ đính kèm' })).toBeVisible();
    expect(within(dialog).queryByRole('heading', { name: /Lịch sử/ })).toBeNull();
    expect(urls.some((url) => url.includes('/nat/r1/history'))).toBe(false);
  });
});

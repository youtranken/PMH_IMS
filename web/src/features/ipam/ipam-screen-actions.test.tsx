import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { IpamScreen } from './ipam-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const SUBNET = {
  id: 'n1', name: 'LAN E2E', cidr: '172.16.10.0/24', siteId: null, siteCode: null, vlan: 10, gateway: null,
  description: null, createdBy: 'sa', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  total: 254, used: 1, free: 253, percent: 0, everCount: 1, voided: false,
};

/* PW-B06: "Thêm dải mạng" và "Cấp IP trống kế tiếp" cùng xanh đặc trong một khung nhìn. Đã có dải
   thì việc chính là cấp IP — thêm dải là nút viền. */
describe('Màn Địa chỉ IP — một nút chính', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đã có dải: "Thêm dải mạng" là nút viền', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/ipam/subnets')) return Promise.resolve(jsonResponse(200, [SUBNET]));
      return Promise.resolve(jsonResponse(200, []));
    }));
    renderWithI18n(
      <MemoryRouter initialEntries={['/ip-addresses']}>
        <ToastProvider>
          <ConfirmProvider>
            <IpamScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const add = await screen.findByRole('button', { name: 'Thêm dải mạng' });
    await screen.findAllByText('172.16.10.0/24');
    expect(add).not.toHaveClass('primary');
  });
});

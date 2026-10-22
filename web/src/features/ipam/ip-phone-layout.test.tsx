import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { cssRules, declValue } from '@/test/css-test-kit';
import { IpamScreen } from './ipam-screen';

/*
 * PW-B05 (Q-33): ở 390px dòng IP đầu tiên nằm dưới 9 hàng điều khiển. Trên điện thoại: Xuất và
 * Giấy tờ vào một nút ⋯, thông tin dải một dòng (bỏ người tạo + mô tả), không có "Bản đồ".
 */
const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const SUBNET = {
  id: 'n1', name: 'LAN E2E', cidr: '172.16.10.0/24', siteId: null, siteCode: null, vlan: 10, gateway: null,
  description: 'Mô tả dài của dải', createdBy: 'sa', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  total: 254, used: 1, free: 253, percent: 0, everCount: 1, voided: false, voidedAt: null,
};

function viewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  }) as unknown as typeof window.matchMedia;
}

function render() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/v1/ipam/subnets?') || url === '/api/v1/ipam/subnets') {
      return Promise.resolve(jsonResponse(200, [SUBNET]));
    }
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
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
});

describe('Màn Địa chỉ IP ở 390px', () => {
  it('Xuất + Giấy tờ vào ⋯, không có "Bản đồ", thông tin dải bỏ người tạo + mô tả', async () => {
    viewport(390);
    render();
    const more = await screen.findByRole('button', { name: 'Xuất & giấy tờ của 172.16.10.0/24' });
    expect(screen.queryByRole('button', { name: 'Xuất Excel' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Giấy tờ/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Bản đồ' })).toBeNull();
    expect(screen.queryByText('Mô tả dài của dải')).toBeNull();
    expect(screen.queryByText(/Khai 01\/01\/2026/)).toBeNull();

    await userEvent.click(more);
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Giấy tờ (0)', 'Xuất dải đang xem', 'Xuất tất cả']);
  });

  it('desktop: giữ nút Xuất Excel, Giấy tờ và kiểu xem Bản đồ', async () => {
    viewport(1366);
    render();
    expect(await screen.findByRole('button', { name: 'Xuất Excel' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Giấy tờ/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bản đồ' })).toBeInTheDocument();
    expect(screen.getByText('Mô tả dài của dải')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Xuất & giấy tờ/ })).toBeNull();
  });
});

describe('Thông tin dải ở 390px', () => {
  it('.pane-sub một dòng (không xuống hàng), vuốt ngang khi dài', () => {
    const rule = cssRules('primitives.css').find((r) => r.selector === '.pane-sub' && r.media === '(max-width: 600px)');
    expect(rule).toBeDefined();
    expect(declValue(rule!.body, 'flex-wrap')).toBe('nowrap');
    expect(declValue(rule!.body, 'overflow-x')).toBe('auto');
  });
});

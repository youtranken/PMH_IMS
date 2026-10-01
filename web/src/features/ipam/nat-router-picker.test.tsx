import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';
import { NatScreen } from './nat-screen';

/**
 * NET-041 + Q-20: ô Router của form NAT có bộ lọc LOẠI (chip, chọn nhiều), mặc định các loại
 * mang cờ "Router/Firewall"; "Tất cả loại" mở lại toàn bộ kho. Chọn máy không phải loại Router
 * chỉ cảnh báo, không chặn.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [
    { id: 'fw', name: 'Firewall', hasPortMap: true, isRouter: true, description: null, active: true },
    { id: 'cam', name: 'Camera', hasPortMap: false, isRouter: false, description: null, active: true },
  ],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

function mockFetch(routerTypes = LISTS.deviceTypes) {
  const deviceUrls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { ...LISTS, deviceTypes: routerTypes }));
      }
      if (url.startsWith('/api/v1/devices')) {
        deviceUrls.push(url);
        const fw = { id: 'd-fw', code: 'FW-01', name: 'Draytek', siteCode: 'HCM', deviceTypeId: 'fw' };
        const cam = { id: 'd-cam', code: 'CAM-01', name: 'Camera cổng', siteCode: null, deviceTypeId: 'cam' };
        const items = url.includes('deviceTypeIds=fw') ? [fw] : [cam, fw];
        return Promise.resolve(jsonResponse(200, { items }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return deviceUrls;
}

async function openRouterPicker() {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <NatScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: 'Thêm luật NAT' }));
  await user.click(await screen.findByRole('combobox', { name: 'Router' }));
  return user;
}

describe('Ô Router của sổ NAT', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mặc định chỉ loại Router/Firewall, mục ghi kèm site', async () => {
    const urls = mockFetch();
    await openRouterPicker();
    expect(await screen.findByRole('option', { name: /FW-01/ })).toHaveTextContent('HCM');
    expect(screen.queryByRole('option', { name: /CAM-01/ })).toBeNull();
    // Ô "Máy đích" cũng hỏi /devices (mọi loại) — nên chỉ khẳng định ô Router đã lọc theo loại,
    // và lọc bằng MỘT lượt hỏi nhiều loại (`deviceTypeIds`).
    expect(urls.some((url) => url.includes('deviceTypeIds=fw'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Firewall' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Tất cả loại" mở lại toàn bộ kho; chọn máy không phải Router chỉ cảnh báo', async () => {
    mockFetch();
    const user = await openRouterPicker();
    await user.click(screen.getByRole('button', { name: 'Tất cả loại' }));
    await user.click(screen.getByRole('combobox', { name: 'Router' }));
    await user.click(await screen.findByRole('option', { name: /CAM-01/ }));
    expect(
      screen.getByText('Máy này không thuộc loại Router — vẫn lưu được, nhưng kiểm lại cho chắc.'),
    ).toBeVisible();
  });

  it('"Thêm thiết bị mới" mở hộp Thêm thiết bị với loại đang lọc điền sẵn', async () => {
    mockFetch();
    const user = await openRouterPicker();
    await user.click(await screen.findByRole('button', { name: 'Thêm thiết bị mới' }));
    const form = await screen.findByRole('dialog', { name: 'Thêm thiết bị' });
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Loại' })).toHaveTextContent('Firewall'),
    );
  });

  it('danh mục chưa loại nào mang cờ: hiện mọi thiết bị và nói rõ vì sao', async () => {
    mockFetch(LISTS.deviceTypes.map((type) => ({ ...type, isRouter: false })));
    await openRouterPicker();
    expect(await screen.findByRole('option', { name: /CAM-01/ })).toBeVisible();
    expect(screen.getByText(/Chưa loại thiết bị nào được đánh dấu Router\/Firewall/)).toBeVisible();
    // Chỉ thẳng tới chỗ sửa, mở tab mới để form NAT đang gõ dở không mất.
    const link = screen.getByRole('link', { name: /Danh mục → Loại thiết bị/ });
    expect(link).toHaveAttribute('href', '/admin/catalog?tab=device_type');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

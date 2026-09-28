import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { CatalogScreen } from './catalog-screen';

const SA = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const MEMBER = { role: 'member', csrfToken: 't', email: 'tv@pmh.com.vn' } as unknown as Me;

const SITE_HCM = { id: 's-hcm', code: 'E2E-HCM', name: 'Hồ Chí Minh', address: null, active: true };
const CABINET = {
  id: 'c-1',
  code: 'TU-E2E-HCM-01',
  siteId: 's-hcm',
  siteCode: 'E2E-HCM',
  description: 'Phòng máy',
  uHeight: 42,
  active: true,
};

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://x');
    if (url.pathname === '/api/v1/catalog') {
      return Promise.resolve(
        jsonResponse(200, {
          sites: [SITE_HCM],
          cabinets: [CABINET],
          deviceTypes: [],
          vendors: [],
          departments: [],
          ispProviders: [],
          servicePorts: [],
        }),
      );
    }
    if (url.pathname === '/api/v1/catalog/cabinet') {
      return Promise.resolve(jsonResponse(200, { items: [CABINET], total: 1 }));
    }
    return Promise.resolve(jsonResponse(200, { items: [SITE_HCM], total: 1 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function listCalls(fetchMock: ReturnType<typeof stubFetch>, entity: string): URL[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://x'))
    .filter((url) => url.pathname === `/api/v1/catalog/${entity}`);
}

function Address() {
  return <output aria-label="địa chỉ">{useLocation().search}</output>;
}

function renderAt(entry: string, me: Me = SA) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <CatalogScreen me={me} />
          <Address />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Màn Danh mục — trạng thái trên URL, bộ lọc, vai', () => {
  afterEach(() => vi.unstubAllGlobals());

  /* F5 hay link gửi đồng nghiệp phải mở lại đúng tab đang xem, không về Site. */
  it('?tab=cabinet mở thẳng tab Tủ mạng và hỏi đúng danh mục tủ', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/catalog?tab=cabinet');
    expect(await screen.findByText('TU-E2E-HCM-01')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toHaveAttribute('aria-selected', 'true');
    expect(listCalls(fetchMock, 'cabinet').length).toBeGreaterThan(0);
    // Cột "Thuộc site" có cả tên site, không chỉ mã.
    expect(screen.getByText('Hồ Chí Minh')).toBeInTheDocument();
  });

  it('đổi tab ghi lên URL; lọc trạng thái gửi ?active=false lên API', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    await user.click(screen.getByRole('tab', { name: 'Tủ mạng' }));
    await waitFor(() =>
      expect(screen.getByLabelText('địa chỉ')).toHaveTextContent('tab=cabinet'),
    );
    await user.click(screen.getByRole('button', { name: 'Lọc theo trạng thái' }));
    await user.click(screen.getByRole('option', { name: 'Đã vô hiệu hóa' }));
    await waitFor(() =>
      expect(listCalls(fetchMock, 'cabinet').some((url) => url.searchParams.get('active') === 'false')).toBe(true),
    );
    expect(screen.getByLabelText('địa chỉ')).toHaveTextContent('status=inactive');
  });

  it('SA thấy "Nhập từ Excel" và KHÔNG còn nút "Tải file mẫu" ở đầu trang (nó nằm trong hộp nhập)', async () => {
    stubFetch();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    expect(screen.getByRole('button', { name: 'Nhập từ Excel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tải file mẫu/ })).not.toBeInTheDocument();
  });

  it('member không có đường nhập Excel và được nói rõ ai làm việc đó (Q-12)', async () => {
    stubFetch();
    renderAt('/admin/catalog', MEMBER);
    await screen.findByText('E2E-HCM');
    expect(screen.queryByRole('button', { name: 'Nhập từ Excel' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Vô hiệu hóa, xóa và nhập Excel do Quản trị thực hiện.'),
    ).toBeInTheDocument();
  });

  it('menu dòng: "Vô hiệu hóa" là việc cảnh báo, tách vạch khỏi "Xóa"', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    await user.click(screen.getByRole('button', { name: /Thao tác với E2E-HCM/ }));
    expect(screen.getByRole('menuitem', { name: 'Vô hiệu hóa' })).toHaveClass('warn');
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toHaveClass('danger');
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(2);
  });
});

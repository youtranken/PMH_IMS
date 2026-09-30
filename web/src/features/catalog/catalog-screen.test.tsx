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
    expect(screen.getByRole('tab', { name: /^Tủ mạng/ })).toHaveAttribute('aria-selected', 'true');
    expect(listCalls(fetchMock, 'cabinet').length).toBeGreaterThan(0);
    // Cột "Thuộc site" có cả tên site, không chỉ mã.
    expect(screen.getByText('Hồ Chí Minh')).toBeInTheDocument();
  });

  it('đổi tab ghi lên URL; lọc trạng thái gửi ?active=false lên API', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    await user.click(screen.getByRole('tab', { name: /^Tủ mạng/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('địa chỉ')).toHaveTextContent('tab=cabinet'),
    );
    await user.click(screen.getByRole('button', { name: 'Lọc theo trạng thái' }));
    await user.click(screen.getByRole('option', { name: 'Đã ngừng dùng' }));
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
      screen.getByText('Ngừng dùng, xóa và nhập Excel do Quản trị thực hiện.'),
    ).toBeInTheDocument();
  });

  it('menu dòng: "Ngừng dùng" là việc cảnh báo, tách vạch khỏi "Xóa"', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    await user.click(screen.getByRole('button', { name: /Thao tác với E2E-HCM/ }));
    expect(screen.getByRole('menuitem', { name: 'Ngừng dùng' })).toHaveClass('warn');
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toHaveClass('danger');
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(2);
  });

  /* Q-18: trạng thái "Đã ngừng dùng" đọc ra ngay bằng màu đỏ; lối quay lại "Dùng lại" màu xanh.
     Việc "Ngừng dùng" vẫn là `warn` — đỏ để dành cho việc không đảo được. */
  it('mục đã ngừng dùng: huy hiệu đỏ, "Dùng lại" màu xanh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, { items: [{ ...SITE_HCM, active: false, usage: [] }], total: 1 }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    const badges = screen.getAllByText('Đã ngừng dùng', { selector: '.badge' });
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect(badge).toHaveClass('danger');
    await user.click(screen.getAllByRole('button', { name: /Thao tác với E2E-HCM/ })[0]);
    expect(screen.getByRole('menuitem', { name: 'Dùng lại' })).toHaveClass('ok');
  });

  it('cột "Đang dùng ở": số bấm được sang danh sách lọc sẵn; số màn đích không lọc được thì chữ thường', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/v1/catalog/site') {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                ...SITE_HCM,
                usage: [
                  { kind: 'device', count: 12 },
                  { kind: 'subnet', count: 1 },
                ],
              },
              { ...SITE_HCM, id: 's-dn', code: 'E2E-DN', name: 'Đà Nẵng', usage: [] },
            ],
            total: 2,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/catalog');
    const devices = await screen.findByRole('link', { name: '12 thiết bị' });
    expect(devices).toHaveAttribute('href', '/devices?siteId=s-hcm');
    expect(screen.getByText('1 dải IP')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '1 dải IP' })).not.toBeInTheDocument();
    expect(screen.getByText('Chưa dùng')).toBeInTheDocument();
  });

  it('mục đang được dùng: "Xóa" bị khóa kèm lý do; mục chưa dùng thì Xóa được', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(200, {
          items: [
            { ...SITE_HCM, usage: [{ kind: 'device', count: 3 }] },
            { ...SITE_HCM, id: 's-dn', code: 'E2E-DN', name: 'Đà Nẵng', usage: [] },
          ],
          total: 2,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderAt('/admin/catalog');
    await screen.findByText('E2E-HCM');
    await user.click(screen.getByRole('button', { name: /Thao tác với E2E-HCM/ }));
    const blocked = screen.getByRole('menuitem', { name: 'Xóa' });
    expect(blocked).toBeDisabled();
    expect(screen.getByText('Đang dùng ở 3 thiết bị — hãy Ngừng dùng')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Thao tác với E2E-DN/ }));
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toBeEnabled();
  });
});

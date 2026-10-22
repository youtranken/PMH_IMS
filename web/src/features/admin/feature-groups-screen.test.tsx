import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { Me } from '@/lib/me';
import { ToastProvider } from '@/ui/toast';
import { FeatureGroupsScreen } from './feature-groups-screen';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const GROUPS = [
  { id: 'g1', name: 'Mạng', features: ['overview', 'network'], memberCount: 2 },
  { id: 'g2', name: 'Tài sản', features: ['assets'], memberCount: 0 },
];

function renderScreen(respond: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(respond(String(input), init)));
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(
    [{ path: '/admin/feature-groups', element: <ToastProvider><FeatureGroupsScreen me={ME} /></ToastProvider> }],
    { initialEntries: ['/admin/feature-groups'] },
  );
  renderWithI18n(<RouterProvider router={router} />);
  return fetchMock;
}

const writes = (fetchMock: ReturnType<typeof renderScreen>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

describe('Màn Nhóm quyền (Q-31)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bảng tick: cột = nhóm (kèm số người), ô theo đúng tick đã lưu', async () => {
    renderScreen(() => jsonResponse(200, GROUPS));
    expect(await screen.findByRole('checkbox', { name: 'Mạng · Mạng' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mạng · Tài sản' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tài sản · Sự cố · 0206' })).not.toBeChecked();
    expect(screen.getByText('2 Người')).toBeInTheDocument();
    // Nhóm còn người thì không xoá được ngay trên bảng.
    expect(screen.getAllByRole('button', { name: 'Xóa' })[0]).toBeDisabled();
  });

  it('tick rồi Lưu → PATCH đúng nhóm đổi với đủ danh sách tick', async () => {
    const fetchMock = renderScreen((_url, init) => (init?.method === 'PATCH' ? new Response(null, { status: 204 }) : jsonResponse(200, GROUPS)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Tài sản · Xin mở két' }));
    expect(screen.getByText('Đã đổi 1 nhóm')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(1));
    const [url, init] = writes(fetchMock)[0];
    expect(url).toBe('/api/v1/feature-groups/g2');
    expect(JSON.parse(String(init?.body))).toEqual({ features: ['assets', 'break_glass'] });
  });

  it('tick 0208 → ô 0206 tự tick và khóa', async () => {
    renderScreen(() => jsonResponse(200, GROUPS));
    const user = userEvent.setup();
    const incidents = await screen.findByRole('checkbox', { name: 'Tài sản · Sự cố · 0206' });
    expect(incidents).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'Tài sản · Theo dõi antivirus · 0208' }));
    expect(incidents).toBeChecked();
    expect(incidents).toBeDisabled();
  });

  it('bỏ hết tick của một nhóm → báo lỗi một dòng, không gọi API', async () => {
    const fetchMock = renderScreen(() => jsonResponse(200, GROUPS));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Tài sản · Tài sản' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nhóm "Tài sản" phải tick ít nhất một mục.');
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('API từ chối (người phụ trách phiếu) → hiện đúng câu của API, giữ nháp', async () => {
    renderScreen((_url, init) =>
      init?.method === 'PATCH'
        ? jsonResponse(409, { code: 'FEATURE_GROUP_HOLDER', message: 'An đang phụ trách phiếu 0203.' })
        : jsonResponse(200, GROUPS),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Mạng · Tổng quan' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An đang phụ trách phiếu 0203.');
    expect(screen.getByText('Đã đổi 1 nhóm')).toBeInTheDocument();
  });

  it('chưa có nhóm nào → trạng thái trống có nút Thêm nhóm', async () => {
    renderScreen(() => jsonResponse(200, []));
    expect(await screen.findByText('Chưa có nhóm quyền nào.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm nhóm' })).toBeInTheDocument();
  });
});

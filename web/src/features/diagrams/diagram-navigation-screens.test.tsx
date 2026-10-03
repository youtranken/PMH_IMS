import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramSlideshow } from './diagram-slideshow';

/*
 * Màn xem bản vẽ: tìm & bay tới, lớp, chỉ đường; màn trình chiếu. Logic thuần ở
 * `diagram-navigation.test.ts` / `diagram-tree.test.ts`; ở đây chỉ nối dây màn ↔ API giả.
 */

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;

function node(id: string, parentId: string | null, name: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id,
    parentId,
    name,
    nodeType: parentId ? 'floor' : 'company',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    kind: 'official',
    archivedAt: null,
    status: 'official',
    latestVersion: null,
    ...extra,
  };
}

const ROOT = node('d1', null, 'Tầng 3 E2E');
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><g data-cell-id="0"><g data-cell-id="1">' +
  '<g data-cell-id="c-sw"><rect width="10" height="10"/><text>SW-E2E-NAV</text></g>' +
  '<g data-cell-id="c-ap"><rect width="10" height="10"/><text>AP-E2E-NAV</text></g>' +
  '<g data-cell-id="e1"><path d="M0 0 L1 1"/></g></g>' +
  '<g data-cell-id="L-cam"><g data-cell-id="cam"><text>Cam E2E</text></g></g></g></svg>';

function device(id: string, code: string, ips: string[] = []) {
  return {
    id,
    found: true,
    code,
    name: `Máy ${code}`,
    deviceTypeName: 'Switch',
    model: null,
    serial: null,
    status: 'in_use',
    ips,
    siteCode: null,
    cabinetCode: null,
    u: null,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    cell: { style: '', label: code, width: 1, height: 1 },
  };
}

const VERSION = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const CONTENT = {
  diagram: ROOT,
  version: { ...VERSION, xml: '<mxfile/>', svg: SVG },
  deviceCells: [
    { cellId: 'c-sw', deviceId: 'SW', code: 'SW-E2E-NAV' },
    { cellId: 'c-ap', deviceId: 'AP', code: 'AP-E2E-NAV' },
  ],
  devices: [device('SW', 'SW-E2E-NAV', ['10.9.0.1']), device('AP', 'AP-E2E-NAV')],
  cableEdges: [{ cellId: 'e1', linkId: 'L1', state: 'linked', sourceDeviceId: 'SW', targetDeviceId: 'AP' }],
  links: [],
  cableTypes: [],
  layers: [
    { id: '1', name: '' },
    { id: 'L-cam', name: 'Camera' },
  ],
  cells: [
    { id: 'c-sw', kind: 'device', layer: '1', bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { id: 'c-ap', kind: 'device', layer: '1', bounds: { x: 200, y: 0, width: 10, height: 10 } },
    { id: 'e1', kind: 'edge', layer: '1', bounds: null },
    { id: 'cam', kind: 'shape', layer: 'L-cam', bounds: { x: 400, y: 0, width: 10, height: 10 } },
  ],
};

function routeFetch(routes: Record<string, (url: string) => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit](url) : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(path: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/diagrams" element={<p>Cây bản vẽ</p>} />
            <Route path="/diagrams/:id" element={<DiagramScreen me={ME} />} />
            <Route path="/diagrams/:id/present" element={<DiagramSlideshow me={ME} />} />
          </Routes>
          <Where />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const BASE = {
  '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
  '/api/v1/diagrams/d1/content': () => jsonResponse(200, CONTENT),
  '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
};

const dimmed = (id: string) => document.querySelector(`[data-cell-id="${id}"]`)?.hasAttribute('data-ims-dim');

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe('Tìm thiết bị, bay tới', () => {
  it('có trên bản vẽ (theo IP): bay tới + tô sáng máy và dây của nó, không hỏi server', async () => {
    const fetchMock = routeFetch(BASE);
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tìm' }));
    await user.type(screen.getByRole('searchbox', { name: 'Mã, tên hoặc IP' }), '10.9.0');
    await user.click(screen.getByRole('button', { name: 'Tìm và bay tới' }));
    expect(await screen.findByText('Đang tô sáng dây của SW-E2E-NAV.')).toBeInTheDocument();
    expect(dimmed('c-sw')).toBe(false);
    expect(dimmed('L-cam')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/diagrams/find'))).toBe(false);
  });

  it('không có trên bản vẽ: liệt kê bản vẽ khác chứa nó, mở với ?focus= để bay tới', async () => {
    routeFetch({
      ...BASE,
      '/api/v1/diagrams/find': () => jsonResponse(200, [{ id: 'CORE', code: 'CORE-E2E', name: 'Lõi', diagrams: [{ id: 'd9', name: 'Tổng E2E' }] }]),
    });
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tìm' }));
    await user.type(screen.getByRole('searchbox', { name: 'Mã, tên hoặc IP' }), 'core-e2e');
    await user.click(screen.getByRole('button', { name: 'Tìm và bay tới' }));
    const link = await screen.findByRole('link', { name: 'CORE-E2E — Tổng E2E' });
    expect(link).toHaveAttribute('href', '/diagrams/d9?focus=CORE');
  });

  it('không có ở đâu cả: báo không tìm thấy', async () => {
    routeFetch({ ...BASE, '/api/v1/diagrams/find': () => jsonResponse(200, []) });
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tìm' }));
    await user.type(screen.getByRole('searchbox', { name: 'Mã, tên hoặc IP' }), 'khong-co-e2e');
    await user.click(screen.getByRole('button', { name: 'Tìm và bay tới' }));
    expect(await screen.findByText('Không tìm thấy "khong-co-e2e" trên bản vẽ này hay trong kho.')).toBeInTheDocument();
  });
});

describe('Lớp', () => {
  it('nút "Lớp" bày lớp draw.io + nhóm loại thiết bị; tắt "Camera" ẩn ô của lớp đó', async () => {
    routeFetch(BASE);
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lớp' }));
    expect(screen.getByRole('checkbox', { name: 'Lớp nền' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Switch' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Camera' }));
    expect(document.querySelector('[data-cell-id="cam"]')?.hasAttribute('data-ims-hidden')).toBe(true);
    expect(document.querySelector('[data-cell-id="c-sw"]')?.hasAttribute('data-ims-hidden')).toBe(false);
  });
});

describe('Chỉ đường', () => {
  const DEVICES = { items: [{ id: 'SW', code: 'SW-E2E-NAV', name: 'Máy SW' }, { id: 'ISP', code: 'ISP-E2E-NAV', name: 'Đường ISP' }], total: 2 };

  async function ask(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Chỉ đường' }));
    await user.click(screen.getByRole('combobox', { name: 'Từ máy' }));
    await user.click(await screen.findByRole('option', { name: /SW-E2E-NAV/ }));
    await user.click(screen.getByRole('combobox', { name: 'Tới máy' }));
    await user.click(await screen.findByRole('option', { name: /ISP-E2E-NAV/ }));
    await user.click(screen.getByRole('button', { name: 'Tìm đường' }));
  }

  it('có đường: tô sáng đoạn trên bản vẽ, đoạn ở bản vẽ khác thành mũi tên nhảy sang', async () => {
    const fetchMock = routeFetch({
      ...BASE,
      '/api/v1/devices': () => jsonResponse(200, DEVICES),
      '/api/v1/diagrams/path': () =>
        jsonResponse(200, {
          from: { id: 'SW', code: 'SW-E2E-NAV' },
          to: { id: 'ISP', code: 'ISP-E2E-NAV' },
          path: {
            hops: [
              { deviceId: 'SW', code: 'SW-E2E-NAV', diagrams: [{ id: 'd1', name: 'Tầng 3 E2E' }] },
              { deviceId: 'AP', code: 'AP-E2E-NAV', diagrams: [{ id: 'd1', name: 'Tầng 3 E2E' }] },
              { deviceId: 'ISP', code: 'ISP-E2E-NAV', diagrams: [{ id: 'd9', name: 'Tổng E2E' }] },
            ],
            linkIds: ['L1', 'L9'],
          },
        }),
    });
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await ask(user);
    expect(await screen.findByText(/Đường SW-E2E-NAV → ISP-E2E-NAV: 2 dây\./)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/diagrams/path?from=SW&to=ISP'))).toBe(true);
    for (const id of ['c-sw', 'c-ap', 'e1']) expect(dimmed(id)).toBe(false);
    expect(dimmed('L-cam')).toBe(true);
    expect(screen.getByRole('link', { name: '→ ISP-E2E-NAV (Tổng E2E)' })).toHaveAttribute('href', '/diagrams/d9?focus=ISP');
    await user.click(screen.getByRole('button', { name: 'Bỏ chỉ đường' }));
    expect(dimmed('L-cam')).toBe(false);
  });

  it('không có đường: báo "Không có đường nối giữa A và B trong sơ đồ cổng", không tô gì', async () => {
    routeFetch({
      ...BASE,
      '/api/v1/devices': () => jsonResponse(200, DEVICES),
      '/api/v1/diagrams/path': () => jsonResponse(200, { from: { id: 'SW', code: 'SW-E2E-NAV' }, to: { id: 'ISP', code: 'ISP-E2E-NAV' }, path: null }),
    });
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    await ask(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có đường nối giữa SW-E2E-NAV và ISP-E2E-NAV trong sơ đồ cổng');
    expect(dimmed('L-cam')).toBe(false);
  });
});

describe('Trình chiếu', () => {
  const TREE = [
    node('d1', null, 'Tổng E2E', { officialVersionId: 'v-d1' }),
    node('d2', 'd1', 'Tầng E2E', { officialVersionId: 'v-d2' }),
    node('d3', 'd1', 'Nháp E2E', { officialVersionId: null, status: 'draft' }),
  ];

  it('đi từ tổng xuống chi tiết, mỗi trang tải đúng bản chính thức; → / ← chuyển, Esc thoát', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { ...CONTENT, diagram: TREE[0] }),
      '/api/v1/diagrams/d2/content': () => jsonResponse(200, { ...CONTENT, diagram: TREE[1], version: { ...VERSION, xml: '', svg: SVG.replace('Cam E2E', 'Trang hai E2E') } }),
      '/api/v1/diagrams': () => jsonResponse(200, TREE),
    });
    renderAt('/diagrams/d1/present');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tổng E2E' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Trang đang chiếu' })).toHaveTextContent('Trang 1/2');
    expect(await screen.findByText('Cam E2E')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByText('Trang hai E2E')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Trang đang chiếu' })).toHaveTextContent('Trang 2/2');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/diagrams/d2/content?mode=view&versionId=v-d2'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/diagrams/d3/content'))).toBe(false);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status', { name: 'Trang đang chiếu' })).toHaveTextContent('Trang 1/2');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/diagrams'));
    expect(screen.getByText('Cây bản vẽ')).toBeInTheDocument();
  });

  it('hết ân hạn giữa chừng: hộp nhập mã mở tại chỗ; Esc đóng hộp mà KHÔNG thoát trình chiếu', async () => {
    routeFetch({
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { ...CONTENT, diagram: TREE[0] }),
      '/api/v1/diagrams/d2/content': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
      '/api/v1/diagrams': () => jsonResponse(200, TREE),
    });
    renderAt('/diagrams/d1/present');
    expect(await screen.findByText('Cam E2E')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tiếp →' }));
    expect(await screen.findByRole('dialog', { name: 'Xác nhận danh tính' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Nội dung bản vẽ cần mã 2 lớp')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/diagrams/d1/present');
    expect(screen.getByRole('status', { name: 'Trang đang chiếu' })).toHaveTextContent('Trang 2/2');
  });

  it('nhánh chưa có bản chính thức nào: báo rõ, không tải nội dung', async () => {
    const fetchMock = routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, [node('d3', null, 'Nháp E2E', { officialVersionId: null })]) });
    renderAt('/diagrams/d3/present');
    expect(await screen.findByText('Nhánh này chưa có bản chính thức nào để trình chiếu')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content'))).toBe(false);
  });
});

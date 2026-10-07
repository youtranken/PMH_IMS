import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within, pickMenuItem } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramTreeScreen } from './diagram-tree-screen';

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const MEMBER = { ...SA, role: 'member' } as Me;

function node(id: string, name: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id,
    parentId: null,
    name,
    nodeType: 'floor',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    kind: 'official',
    archivedAt: null,
    status: 'official',
    latestVersion: { id: 'v1', seq: 1, savedAt: '2026-10-03T01:00:00Z', savedBy: 'sa@e2e.local' },
    officialSeq: 1,
    ...extra,
  };
}

const OFFICIAL = node('d1', 'Tầng 1 E2E');
const PRES = node('p1', 'Tầng 1 E2E — trình bày', {
  kind: 'presentation',
  status: 'draft',
  officialSeq: null,
  source: { diagramId: 'd1', name: 'Tầng 1 E2E', versionId: 'v1', seq: 1, officialVersionId: 'v1', officialSeq: 1 },
});
const PRES_NEWER = { ...PRES, source: { ...PRES.source!, officialVersionId: 'v4', officialSeq: 4 } };
const VERSION = { id: 'pv1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Core E2E</text></svg>';
const XML =
  '<mxfile><diagram id="pg" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="c1" value="Tầng" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';
const SETTINGS = { initTimeoutSeconds: 20, presenceTtlSeconds: 60, xmlMaxKb: 1 };

function routeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit](init) : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string, me: Me = SA) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/diagrams" element={<DiagramTreeScreen me={me} />} />
            <Route path="/diagrams/:id" element={<DiagramScreen me={me} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

/** Danh sách phiên bản là nội dung bản vẽ: bài cây cho server đòi mã, panel chỉ hiện nút nhập mã. */
const LOCKED = {
  '/versions': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
  '/publications': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
};

describe('Bản đồ — bản trình bày đứng riêng (Q-23)', () => {
  it('bản trình bày không nằm trên bản đồ chính thức mà ở dải "Bản trình bày (n)"; panel hiện nguồn và báo bản gốc có bản mới', async () => {
    routeFetch({ ...LOCKED, '/api/v1/diagrams': () => jsonResponse(200, [OFFICIAL, PRES_NEWER]) });
    renderAt('/diagrams?node=p1');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const chips = within(map).getByRole('heading', { name: 'Bản trình bày (1)' }).parentElement as HTMLElement;
    expect(within(chips).getByRole('button', { name: 'Tầng 1 E2E — trình bày' })).toHaveAttribute('aria-current', 'true');
    expect(map.querySelectorAll('.dmap-banner')).toHaveLength(1);
    const panel = screen.getByRole('complementary', { name: 'Bản vẽ đang chọn' });
    expect(panel).toHaveTextContent('Từ "Tầng 1 E2E" · chính thức v1');
    expect(panel).toHaveTextContent('Bản gốc đã có phiên bản mới (4)');
    // Bản trình bày không qua duyệt: không Phát hành / Gửi duyệt.
    expect(within(panel).queryByRole('button', { name: /^(Phát hành|Gửi duyệt)/ })).toBeNull();
  });
});

describe('Bản đồ — Thành viên quản bản trình bày của mình', () => {
  const MINE = { ...PRES, id: 'p-mine', name: 'E2E Của tôi', createdBy: 'sa@e2e.local' };
  const THEIRS = { ...PRES, id: 'p-theirs', name: 'E2E Của người khác', createdBy: 'other@e2e.local', ownerEmail: 'other@e2e.local' };

  it('bản mình tạo: Đổi tên + Lưu trữ; bản người khác: không có thao tác', async () => {
    routeFetch({ ...LOCKED, '/api/v1/diagrams': () => jsonResponse(200, [OFFICIAL, MINE, THEIRS]) });
    renderAt('/diagrams?node=p-theirs', MEMBER);
    await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    expect(screen.queryByRole('button', { name: 'Thao tác với E2E Của người khác' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'E2E Của tôi' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thao tác với E2E Của tôi' }));
    // Bản trình bày chưa bao giờ phát hành: người tạo xóa hẳn được (Q-23).
    const names = (await screen.findAllByRole('menuitem')).map((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return copy.textContent;
    });
    expect(names).toEqual(['Đổi tên', 'Lưu trữ', 'Xóa hẳn']);
  });

  it('Đổi tên: hộp chỉ có ô tên, PATCH chỉ gửi tên', async () => {
    const fetchMock = routeFetch({
      ...LOCKED,
      '/api/v1/diagrams/p-mine': () => jsonResponse(200, { ...MINE, name: 'E2E Tên mới' }),
      '/api/v1/diagrams': () => jsonResponse(200, [OFFICIAL, MINE]),
    });
    renderAt('/diagrams?node=p-mine', MEMBER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với E2E Của tôi' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đổi tên "E2E Của tôi"' });
    expect(screen.queryByRole('combobox', { name: 'Loại bản vẽ' })).toBeNull();
    const name = screen.getByRole('textbox', { name: /Tên bản vẽ/ });
    await user.clear(name);
    await user.type(name, 'E2E Tên mới');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await screen.findByText('Đã lưu "E2E Tên mới".');
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ name: 'E2E Tên mới' });
    expect(dialog).not.toBeInTheDocument();
  });
});

describe('Màn xem bản trình bày', () => {
  function openView(diagram: DiagramNode) {
    return routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, SETTINGS),
      '/api/v1/diagrams/p1/content': () => jsonResponse(200, { diagram, version: { ...VERSION, xml: XML, svg: SVG }, deviceCells: [], devices: [] }),
      '/api/v1/diagrams/p1/review': () => jsonResponse(200, { approval: null, versionId: null, seq: null, officialSeq: null, summary: null, errors: [], warnings: [] }),
      '/api/v1/diagrams/p1/comments': () => jsonResponse(200, []),
      '/api/v1/diagrams/p1': () => jsonResponse(200, diagram),
    });
  }

  it('dải "BẢN TRÌNH BÀY" + phiên bản đã chép; không Gửi duyệt / Phát hành / ghim / nhân bản', async () => {
    openView(PRES);
    renderAt('/diagrams/p1', MEMBER);
    const band = await screen.findByRole('note', { name: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức' });
    expect(band).toHaveTextContent('Dựa trên bản chính thức phiên bản 1');
    expect(band).not.toHaveTextContent('phiên bản mới');
    expect(await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeInTheDocument();
    for (const name of ['Gửi duyệt', 'Phát hành', 'Tạo bản trình bày']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ghim/ })).toBeNull();
  });

  it('bản gốc có bản chính thức mới → "Bản gốc đã có phiên bản mới (4)" + link, không tự cập nhật', async () => {
    const fetchMock = openView(PRES_NEWER);
    renderAt('/diagrams/p1');
    const band = await screen.findByRole('note', { name: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức' });
    expect(band).toHaveTextContent('Bản gốc đã có phiên bản mới (4)');
    expect(screen.getByRole('link', { name: 'Mở bản gốc' })).toHaveAttribute('href', '/diagrams/d1');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/diagrams/d1/content'))).toBe(false);
  });
});

describe('"Tạo bản trình bày" từ bản chính thức', () => {
  it('Thành viên bấm → hộp tên (tuỳ chọn) → POST /presentations → sang bản mới', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, SETTINGS),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: OFFICIAL, version: { ...VERSION, xml: XML, svg: SVG }, deviceCells: [], devices: [] }),
      '/api/v1/diagrams/d1/presentations': () => jsonResponse(201, { ...PRES, name: 'E2E Đề xuất AP' }),
      '/api/v1/diagrams/p1': () => jsonResponse(200, PRES),
      '/api/v1/diagrams/d1': () => jsonResponse(200, OFFICIAL),
    });
    renderAt('/diagrams/d1', MEMBER);
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Tạo bản trình bày');
    const dialog = await screen.findByRole('dialog', { name: 'Tạo bản trình bày từ "Tầng 1 E2E"' });
    expect(dialog).toHaveTextContent('bản chính thức giữ nguyên');
    await user.type(screen.getByLabelText('Tên bản trình bày'), 'E2E Đề xuất AP');
    await user.click(screen.getByRole('button', { name: 'Tạo' }));
    expect(await screen.findByText('Đã tạo bản trình bày "E2E Đề xuất AP".')).toBeInTheDocument();
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).find(([url, init]) => url.endsWith('/d1/presentations') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'E2E Đề xuất AP' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tầng 1 E2E — trình bày' })).toBeInTheDocument();
  });

  it('bản chưa có bản chính thức → không có nút', async () => {
    const draft = node('d1', 'Nháp E2E', { status: 'draft', officialSeq: null });
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, SETTINGS),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: draft, version: { ...VERSION, xml: XML, svg: SVG }, deviceCells: [], devices: [] }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, draft),
    });
    renderAt('/diagrams/d1');
    expect(await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tạo bản trình bày' })).toBeNull();
  });
});

describe('Sửa bản trình bày — thiết bị dự kiến và ảnh tự do', () => {
  async function openEditor(diagram: DiagramNode = PRES) {
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, SETTINGS),
      '/api/v1/diagrams/p1/content': () => jsonResponse(200, { diagram, version: { ...VERSION, xml: XML, svg: null }, deviceCells: [], devices: [] }),
      '/api/v1/diagrams/p1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/p1': () => jsonResponse(200, diagram),
    });
    const router = createMemoryRouter([{ path: '/diagrams/:id', element: <DiagramScreen me={MEMBER} /> }], { initialEntries: ['/diagrams/p1?mode=edit'] });
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const frame = (await screen.findByTitle('Khung vẽ draw.io')) as HTMLIFrameElement;
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const fromDrawio = (data: Record<string, unknown>) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), source: frame.contentWindow }));
      });
    fromDrawio({ event: 'init' });
    const patches = () =>
      posted.mock.calls
        .map(([data]) => JSON.parse(String(data)) as { action: string; patch?: { u: Record<string, { cells: { i: { style: string; xmlValue: string }[] } }> } })
        .filter((m) => m.action === 'patch');
    const exportRequested = () => posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'));
    return { fromDrawio, patches, exportRequested };
  }

  it('dải trình bày cũng hiện khi sửa; "Thiết bị dự kiến" chèn ô ims_planned="1" viền đứt, nhãn "Dự kiến"', async () => {
    const { fromDrawio, patches, exportRequested } = await openEditor();
    expect(screen.getByRole('note', { name: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).toBeNull();
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Thiết bị dự kiến');
    await user.click(screen.getByRole('button', { name: 'Chèn vào bản vẽ' }));
    expect(await screen.findByText('Nhập tên thiết bị.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Tên thiết bị/), 'AP tầng 3');
    await user.type(screen.getByLabelText('Giá dự kiến'), '3500000');
    await user.type(screen.getByLabelText('Nhà cung cấp'), 'NCC E2E');
    await user.click(screen.getByRole('button', { name: 'Chèn vào bản vẽ' }));
    await vi.waitFor(() => expect(exportRequested()).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: XML, currentPage: 0, modelBounds: { x: 0, y: 0, width: 60, height: 60 } });

    const [patch] = patches();
    const cell = patch.patch!.u.pg.cells.i[0];
    expect(cell.xmlValue).toContain('ims_planned="1"');
    expect(cell.xmlValue).toContain('ims_planned_price="3500000"');
    expect(cell.xmlValue).toContain('Dự kiến');
    expect(cell.xmlValue).not.toContain('ims_device_id');
    expect(cell.style).toContain('dashed=1');
    expect(await screen.findByText('Đã chèn "AP tầng 3" vào bản vẽ.')).toBeInTheDocument();
    expect(screen.getByText('Có thay đổi chưa lưu.')).toBeInTheDocument();
  });

  it('"Thêm ảnh": PNG thật → ô ảnh nhúng; tệp không phải ảnh / quá trần cỡ → báo lỗi, không chèn', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 640;
        naturalHeight = 320;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          window.setTimeout(() => this.onload?.(), 0);
        }
      },
    );
    const { fromDrawio, patches, exportRequested } = await openEditor();
    const user = userEvent.setup();
    const input = screen.getByLabelText('Chọn ảnh để chèn (JPEG, PNG, WebP)');

    await user.upload(input, new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByText('Chỉ nhận ảnh JPEG, PNG hoặc WebP.')).toBeInTheDocument();

    const big = new Uint8Array(4096);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await user.upload(input, new File([big], 'big.png', { type: 'image/png' }));
    expect(await screen.findByText(/Ảnh lớn quá: bản vẽ chỉ chứa được tối đa 1 KB/)).toBeInTheDocument();
    expect(exportRequested()).toBe(false);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await user.upload(input, new File([png], 'bao-gia.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(exportRequested()).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: XML, currentPage: 0, modelBounds: { x: 0, y: 0, width: 60, height: 60 } });
    const cell = patches()[0].patch!.u.pg.cells.i[0];
    expect(cell.style).toMatch(/shape=image;image=data:image\/png,[A-Za-z0-9+/=]+;/);
    expect(cell.style).not.toContain(';base64');
    expect(await screen.findByText('Đã chèn ảnh vào bản vẽ.')).toBeInTheDocument();
  });

  it('bản chính thức: không có nút thiết bị dự kiến / ảnh', async () => {
    await openEditor({ ...OFFICIAL, id: 'p1' });
    expect(screen.queryByRole('button', { name: 'Thiết bị dự kiến' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm ảnh' })).toBeNull();
    expect(screen.queryByRole('note', { name: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức' })).toBeNull();
  });
});

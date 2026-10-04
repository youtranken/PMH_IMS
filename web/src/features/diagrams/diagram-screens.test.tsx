import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramDeviceInfo, DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramTreeScreen } from './diagram-tree-screen';

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const MEMBER = { ...ME, role: 'member' } as Me;

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
    status: 'empty',
    latestVersion: null,
    ...extra,
  };
}

const ROOT = node('d1', null, 'Tổng công ty E2E');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Core E2E</text></svg>';

function routeFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit]() : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

function renderScreen(path: string, me: Me = ME) {
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

beforeEach(() => narrow(false));
afterEach(() => vi.unstubAllGlobals());

describe('Màn mở bản vẽ — nội dung đòi mã phạm vi sơ đồ (AD-17)', () => {
  it('server đòi mã sơ đồ → hộp hỏi mã phạm vi sơ đồ; đóng hộp thì màn khoá, có nút nhập mã', async () => {
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
    renderScreen('/diagrams/d1');
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận danh tính' });
    expect(dialog).toHaveTextContent('Mã này chỉ mở phần xem sơ đồ, không mở két.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Hủy' }));
    expect(await screen.findByText('Nội dung bản vẽ cần mã 2 lớp')).toBeInTheDocument();
    // Tên bản vẽ đọc không cần mã — hiện cả khi nội dung còn khoá.
    expect(screen.getByRole('heading', { level: 1, name: 'Tổng công ty E2E' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhập mã để mở' })).toBeInTheDocument();
  });

  it('chế độ xem: SVG từ API hiện trong trình xem dùng chung, không có iframe draw.io', async () => {
    const version = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...version, xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
    renderScreen('/diagrams/d1');
    const viewer = await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(viewer).toHaveTextContent('Core E2E');
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content?mode=view'))).toBe(true);
  });

  it('màn hẹp (< 1024px) mở đường dẫn sửa: thành chế độ XEM kèm "chỉ làm trên máy tính"; không draw.io, không công cụ sửa / gửi duyệt', async () => {
    narrow(true);
    const version = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...version, xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
    renderScreen('/diagrams/d1?mode=edit');
    expect(await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' })).toHaveTextContent('Core E2E');
    expect(screen.getByText('Sửa sơ đồ chỉ làm trên máy tính')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Sửa' })).toBeNull();
    for (const name of ['Gửi duyệt', 'Phát hành', 'Phiên bản', 'Ghim bình luận', 'Tạo bản trình bày']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    // Tên mục, không phải textContent: mục menu có thêm dòng mô tả (aria-hidden) dưới tên.
    expect(await screen.findByRole('menuitem', { name: 'Chỉ đường' })).toBeInTheDocument();
    for (const name of ['Gửi duyệt', 'Phát hành', 'Phiên bản', 'Ghim bình luận', 'Tạo bản trình bày']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content?mode=view'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/presence'))).toBe(false);
  });
});

describe('Cây bản vẽ', () => {
  const TREE = [ROOT, node('d2', 'd1', 'Tầng 1 E2E', { status: 'draft' })];

  it('cha trước con, chỉ tên + loại + trạng thái; nút gập nhánh', async () => {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, TREE) });
    renderScreen('/diagrams');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Tổng công ty E2E'),
      expect.stringContaining('Tầng 1 E2E'),
    ]);
    expect(items[1]).toHaveTextContent('Bản nháp');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tổng công ty E2E', expanded: true }));
    expect(screen.queryByText('Tầng 1 E2E')).toBeNull();
  });

  it.each([
    ['Thành viên trình chiếu + thêm bản vẽ con', MEMBER, ['Trình chiếu', 'Thêm bản vẽ con']],
    ['SA đổi tên / chuyển nhánh / lưu trữ được', ME, ['Trình chiếu', 'Thêm bản vẽ con', 'Đổi tên / chuyển nhánh', 'Lưu trữ']],
  ])('%s', async (_name, me, expected) => {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, [ROOT]) });
    renderScreen('/diagrams', me);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    expect((await screen.findAllByRole('menuitem')).map((el) => el.textContent)).toEqual(expected);
  });

  /* Q-23: bản vẽ tầng/phòng vẽ tiếp từ bản cha, nên "Thêm bản vẽ con" mặc định nhân
     bản; chép nội dung thì hỏi mã sơ đồ như mở xem. */
  it('Thêm bản vẽ con: mặc định nhân bản nội dung mới nhất của bản cha (qua mã sơ đồ); chọn "Bản trống" thì tạo rỗng', async () => {
    const parent = node('d1', null, 'Tổng công ty E2E', {
      status: 'official',
      latestVersion: { id: 'v3', seq: 3, savedAt: '2026-10-03T01:00:00Z', savedBy: 'sa@e2e.local' },
    });
    const calls: string[] = [];
    let copies = 0;
    const fetchMock = routeFetch({
      '/api/v1/diagrams/d1/copied-children': () => {
        calls.push('copy');
        copies += 1;
        return copies === 1
          ? jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })
          : // Có người lưu bản cha (#4) sau khi cây được tải: server nhân bản #4, không phải #3.
            jsonResponse(201, { ...node('c1', 'd1', 'Tầng 2 E2E'), copiedFromSeq: 4 });
      },
      '/api/v1/auth/step-up': () => jsonResponse(200, { status: 'stepped-up', scope: 'diagram', graceMinutes: 10 }),
      '/api/v1/diagrams': () => jsonResponse(200, [parent]),
    });
    renderScreen('/diagrams', MEMBER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thêm bản vẽ con' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Tổng công ty E2E"' });
    const copy = screen.getByRole('radio', { name: 'Nhân bản từ bản cha (phiên bản #3)' });
    expect(copy).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bản trống' })).not.toBeChecked();
    await user.type(screen.getByRole('textbox', { name: /Tên bản vẽ/ }), 'Tầng 2 E2E');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const step = await screen.findByRole('dialog', { name: 'Xác nhận danh tính' });
    expect(step).toBeInTheDocument();
    expect(calls).toEqual(['copy']);
    await user.type(within(step).getAllByRole('textbox')[0], '123456');
    // Mã đủ 6 số là tự gửi; lượt sau gọi lại đúng yêu cầu nhân bản. Số phiên bản theo server.
    expect(await screen.findByText('Đã tạo bản vẽ "Tầng 2 E2E" — nhân bản từ "Tổng công ty E2E" phiên bản #4.')).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
    const body = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([url]) => String(url).includes('/copied-children'))
      .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(body.at(-1)).toEqual({ name: 'Tầng 2 E2E', nodeType: 'floor' });
  });

  it('Thêm bản vẽ con dưới bản cha chưa có nội dung: chỉ "Bản trống", không hỏi mã', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams': () => jsonResponse(201, node('c1', 'd1', 'Tầng 2 E2E')),
    });
    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse(200, [ROOT])));
    renderScreen('/diagrams', MEMBER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thêm bản vẽ con' }));
    await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Tổng công ty E2E"' });
    expect(screen.getByRole('radio', { name: 'Nhân bản từ bản cha' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Bản trống' })).toBeChecked();
    expect(screen.getByText('Bản cha chưa có nội dung nên con bắt đầu từ bản trống.')).toBeInTheDocument();
  });
});

describe('Lưu bản vẽ khi ân hạn sơ đồ đã hết giữa lúc vẽ (Q-23)', () => {
  it('server đòi mã → hộp hỏi mã sơ đồ, nhập xong lưu lại ĐÚNG XML đang có trong bộ nhớ, không xin trình vẽ xuất lại', async () => {
    const version = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    let saves = 0;
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...version, xml: '<mxfile/>', svg: null } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/versions': () => {
        saves += 1;
        return saves === 1
          ? jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })
          : jsonResponse(201, { ...version, id: 'v2', seq: 2, summary: 'Thêm 1 thiết bị' });
      },
      '/api/v1/auth/step-up': () => jsonResponse(200, { status: 'stepped-up', scope: 'diagram', graceMinutes: 10 }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
    const router = createMemoryRouter([{ path: '/diagrams/:id', element: <DiagramScreen me={ME} /> }], {
      initialEntries: ['/diagrams/d1?mode=edit'],
    });
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
    fromDrawio({ event: 'load' });
    /*
     * Bản một trang: tin `save` chỉ mang mô hình trần (`pages=0`), còn XML đi kèm `export` svg thì
     * bị nén — màn xin `export` xml (cả tệp, không nén) trước, rồi mới xin svg.
     */
    fromDrawio({ event: 'save', xml: '<mxGraphModel>NÉT ĐANG VẼ</mxGraphModel>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: '<mxfile>NÉT ĐANG VẼ</mxfile>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"svg"'))).toBe(true));
    fromDrawio({
      event: 'export',
      format: 'svg',
      xml: '<mxfile><diagram>NÉN</diagram></mxfile>',
      data: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`,
    });

    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận danh tính' });
    expect(dialog).toHaveTextContent('Mã này chỉ mở phần xem sơ đồ, không mở két.');
    await userEvent.setup().type(screen.getByLabelText(/mã/i), '654321');

    expect(await screen.findByText('Đã lưu phiên bản #2: Thêm 1 thiết bị')).toBeInTheDocument();
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([url, init]) => String(url).endsWith('/api/v1/diagrams/d1/versions') && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { xml: string; basedOnVersionId: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toMatchObject({ xml: '<mxfile>NÉT ĐANG VẼ</mxfile>', basedOnVersionId: 'v1' });
    // Một lượt xin tệp + một lượt xin svg; nhập mã xong KHÔNG xin trình vẽ xuất lại.
    const exports = posted.mock.calls.filter(([data]) => String(data).includes('"action":"export"'));
    expect(exports).toHaveLength(2);
  });
});

const VERSION = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const CATALOG = { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [] };
const HAVE_XML =
  '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<UserObject label="SW-E2E-HAVE" ims_device_id="dev-have" ims_device_code="SW-E2E-HAVE" id="c1"><mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell></UserObject>' +
  '</root></mxGraphModel></diagram></mxfile>';

function info(id: string, code: string, extra: Partial<DiagramDeviceInfo> = {}): DiagramDeviceInfo {
  return {
    id,
    found: true,
    code,
    name: 'Switch lõi E2E',
    deviceTypeName: 'Switch',
    model: 'C9300',
    serial: 'FOC-E2E',
    status: 'in_use',
    ips: ['10.0.0.5'],
    siteCode: 'HQ',
    cabinetCode: 'R1',
    u: null,
    vendorName: 'NCC E2E',
    vendorPhone: '19001234',
    warrantyEnd: '2027-01-31',
    cell: { style: 'align=center;shape=mxgraph.networks.switch;html=0;', label: `${code}\n10.0.0.5\nHQ · R1`, width: 100, height: 30 },
    ...extra,
  };
}

async function openEditor() {
  const fetchMock = routeFetch({
    '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
    '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...VERSION, xml: HAVE_XML, svg: null }, deviceCells: [], devices: [] }),
    '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
    '/api/v1/diagrams/device-info': () => jsonResponse(200, [info('dev-ok', 'SW-E2E-OK')]),
    '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    '/api/v1/catalog': () => jsonResponse(200, CATALOG),
    '/api/v1/devices?': () =>
      jsonResponse(200, {
        items: [
          { id: 'dev-ok', code: 'SW-E2E-OK', name: 'Switch E2E', status: 'in_use', deviceTypeName: 'Switch', siteCode: 'HQ', cabinetCode: null },
          { id: 'dev-old', code: 'SW-E2E-OLD', name: 'Switch cũ E2E', status: 'retired', deviceTypeName: 'Switch', siteCode: 'HQ', cabinetCode: null },
          { id: 'dev-have', code: 'SW-E2E-HAVE', name: 'Switch có rồi E2E', status: 'in_use', deviceTypeName: 'Switch', siteCode: 'HQ', cabinetCode: null },
        ],
        total: 3,
      }),
  });
  const router = createMemoryRouter([{ path: '/diagrams/:id', element: <DiagramScreen me={ME} /> }], { initialEntries: ['/diagrams/d1?mode=edit'] });
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
  return { fetchMock, frame, posted, fromDrawio };
}

describe('Hộp "Thiết bị kho" trên thanh trên trình vẽ (Q-23)', () => {
  it('nút mở hộp tìm gọn — không cột cố định; máy đã thanh lý không hiện; máy đã có trên bản vẽ hiện nhưng tắt kèm lý do; chèn bằng patch, hộp đóng', async () => {
    const { fetchMock, frame, posted, fromDrawio } = await openEditor();
    const user = userEvent.setup();
    // Sẵn sàng ngay từ `init` (lệnh load đã gửi trước mọi lệnh sau) — không chờ tin `load`.
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    const box = screen.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
    expect(frame).toBeInTheDocument();
    expect(box.contains(frame)).toBe(false);

    // Máy đã thanh lý không có mặt trong hộp (Q-23): hỏi kho bằng `usable=true`, và
    // lỡ server vẫn trả về thì cũng không hiện — chèn máy đã thanh lý là vô lý.
    expect(await screen.findByRole('checkbox', { name: 'Chọn SW-E2E-HAVE để chèn' })).toHaveAccessibleDescription('Đã có trên bản vẽ');
    expect(screen.queryByRole('checkbox', { name: 'Chọn SW-E2E-OLD để chèn' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/devices?') && String(url).includes('usable=true'))).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' }));
    await user.click(screen.getByRole('button', { name: 'Chèn 1 thiết bị' }));
    // Hỏi cả TỆP (export xml), không `getDiff`: bản một trang thì `getDiff` trả mô hình trần, không có id trang để patch.
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: HAVE_XML, currentPage: 0, modelBounds: { x: 0, y: 0, width: 60, height: 60 } });

    const patch = posted.mock.calls.map(([data]) => JSON.parse(String(data)) as { action: string; patch?: { u: Record<string, { cells: { i: { style: string; xmlValue: string; previous?: string }[] } }> } }).find((m) => m.action === 'patch');
    const cell = patch!.patch!.u.p1.cells.i[0];
    expect(cell.style).toBe('align=center;shape=mxgraph.networks.switch;html=0;');
    expect(cell.xmlValue).toContain('ims_device_id="dev-ok"');
    expect(cell.previous).toBe('c1');
    expect(await screen.findByText('Đã chèn SW-E2E-OK vào bản vẽ.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Chèn thiết bị có trong kho' })).toBeNull();

    // Mở lại: máy vừa chèn đã là "đã có" (patch không làm draw.io gửi autosave).
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    expect(await screen.findByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' })).toBeDisabled();
  });

  it('bàn phím: gõ tìm, ↓ xuống danh sách, Space chọn, Enter chèn; Esc đóng hộp', async () => {
    const { fetchMock, posted } = await openEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    const search = screen.getByRole('searchbox', { name: 'Tìm thiết bị' });
    expect(search).toHaveFocus();
    await user.type(search, 'E2E-OK');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=E2E-OK'))).toBe(true));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' })).toHaveFocus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/diagrams/device-info?ids=dev-ok'))).toBe(true));
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'))).toBe(true));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Chèn thiết bị có trong kho' })).toBeNull();
  });
});

describe('Chế độ xem — bấm thiết bị ra thẻ thông tin', () => {
  const SVG_TWO =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><g data-cell-id="d1"><rect width="10" height="10"/><text>SW-E2E-OK</text></g>' +
    '<g data-cell-id="d2"><rect width="10" height="10"/><text>SW-E2E-GONE</text></g></svg>';

  function openViewer() {
    return routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () =>
        jsonResponse(200, {
          diagram: ROOT,
          version: { ...VERSION, xml: '<mxfile/>', svg: SVG_TWO },
          deviceCells: [
            { cellId: 'd1', deviceId: 'dev-ok', code: 'SW-E2E-OK' },
            { cellId: 'd2', deviceId: 'dev-gone', code: 'SW-E2E-GONE' },
          ],
          devices: [info('dev-ok', 'SW-E2E-OK'), { ...info('dev-gone', ''), found: false, code: null }],
        }),
      '/api/v1/diagrams/by-device/dev-ok': () => jsonResponse(200, [ROOT, { id: 'd9', name: 'Phòng server E2E' }]),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
  }

  it('thẻ: mã, tên, loại, model, serial, IP, Site · Tủ, NCC + hotline, bảo hành, bản vẽ khác có máy, Mở hồ sơ', async () => {
    openViewer();
    renderScreen('/diagrams/d1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'SW-E2E-OK' }));
    const card = await screen.findByRole('dialog', { name: 'SW-E2E-OK' });
    for (const text of ['Switch lõi E2E', 'Switch', 'C9300', 'FOC-E2E', '10.0.0.5', 'HQ · R1', 'NCC E2E']) {
      expect(card).toHaveTextContent(text);
    }
    expect(card.querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(await screen.findByRole('link', { name: 'Phòng server E2E' })).toHaveAttribute('href', '/diagrams/d9');
    expect(screen.getByRole('link', { name: 'Mở hồ sơ' })).toHaveAttribute('href', '/devices/dev-ok');
  });

  it('Mở két mở đúng khung két dùng chung (két tự hỏi mã PHẠM VI KÉT), thẻ không chứa giá trị két', async () => {
    const fetchMock = openViewer();
    renderScreen('/diagrams/d1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'SW-E2E-OK' }));
    await user.click(await screen.findByRole('button', { name: 'Mở két' }));
    const vault = await screen.findByRole('dialog', { name: 'Két của SW-E2E-OK' });
    expect(vault).toHaveTextContent('mã vừa nhập để xem sơ đồ không mở két');
    // Thẻ sơ đồ không gọi API giải mã nào — chỉ khung két (VaultPanel) đọc két theo luồng của nó.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reveal'))).toBe(false);
  });

  it('ô trỏ máy không còn trong kho: dấu đỏ, thẻ báo "Không tìm thấy trong kho" — không lỗi trang', async () => {
    openViewer();
    renderScreen('/diagrams/d1');
    const user = userEvent.setup();
    const gone = await screen.findByRole('button', { name: 'SW-E2E-GONE — Không tìm thấy trong kho' });
    expect(gone).toHaveAttribute('data-ims-mark', 'danger');
    await user.click(gone);
    const card = await screen.findByRole('dialog', { name: 'Thiết bị SW-E2E-GONE' });
    expect(card).toHaveTextContent('Không tìm thấy trong kho');
  });
});

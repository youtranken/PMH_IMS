import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, pickMenuItem, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramDeviceInfo, DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';

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
    const dialog = await screen.findByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' });
    // Hộp NHỎ (K-04): nói đang mở gì, không đoạn giải thích phạm vi.
    expect(dialog).toHaveTextContent('Nhập mã 6 số để mở bản vẽ "Tổng công ty E2E".');
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
    for (const name of ['Gửi duyệt', 'Phát hành', 'Phiên bản', 'Ghim bình luận mới', 'Tạo bản trình bày']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    // Tên mục, không phải textContent: mục menu có thêm dòng mô tả (aria-hidden) dưới tên.
    expect(await screen.findByRole('menuitem', { name: 'Chỉ đường' })).toBeInTheDocument();
    for (const name of ['Gửi duyệt', 'Phát hành', 'Phiên bản', 'Ghim bình luận mới', 'Tạo bản trình bày']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content?mode=view'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/presence'))).toBe(false);
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
      '/api/v1/diagrams/d1/publish': () => jsonResponse(201, { versionId: 'v2', seq: 2, warnings: [] }),
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
    fromDrawio({ event: 'autosave', xml: '<mxGraphModel>NÉT ĐANG VẼ</mxGraphModel>' });
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

    const dialog = await screen.findByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' });
    expect(dialog).toHaveTextContent('Nhập mã 6 số để lưu bản vẽ');
    await userEvent.setup().type(within(dialog).getAllByLabelText(/mã/i)[0], '654321');

    expect(await screen.findByText('Đã lưu phiên bản #2: Thêm 1 thiết bị')).toBeInTheDocument();
    // E-04: dòng trạng thái lưu gọn "Đã lưu #n · giờ", đủ chi tiết khi rê chuột.
    const note = screen.getByText(/^Đã lưu #2 · /);
    expect(note).toHaveAttribute('title', 'Nháp #2 · 03/10/2026 08:00 · a');
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([url, init]) => String(url).endsWith('/api/v1/diagrams/d1/versions') && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)) as { xml: string; basedOnVersionId: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toMatchObject({ xml: '<mxfile>NÉT ĐANG VẼ</mxfile>', basedOnVersionId: 'v1' });
    // Một lượt xin tệp + một lượt xin svg; nhập mã xong KHÔNG xin trình vẽ xuất lại.
    const exports = posted.mock.calls.filter(([data]) => String(data).includes('"action":"export"'));
    expect(exports).toHaveLength(2);

    // E-06: lưu xong, lời báo mời bước kế tiếp — Admin/SA "Phát hành #2" phát hành ĐÚNG bản vừa lưu.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Phát hành #2' }));
    const confirm = await screen.findByRole('dialog', { name: /#2/ });
    await user.click(within(confirm).getByRole('button', { name: 'Phát hành' }));
    await vi.waitFor(() =>
      expect(
        (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).some(
          ([url, init]) => String(url).endsWith('/api/v1/diagrams/d1/publish') && JSON.parse(String(init?.body)).versionId === 'v2',
        ),
      ).toBe(true),
    );
  });
});

describe('Lưu khi không có gì đổi (Q-23 05/10)', () => {
  const version = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };

  async function openEditor(saveResponse: () => Response) {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...version, xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/versions': saveResponse,
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
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
    const saves = () => (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([url, init]) => String(url).endsWith('/versions') && init?.method === 'POST');
    return { posted, fromDrawio, saves };
  }

  it('chưa sửa gì: nút Lưu tắt; Ctrl+S trong trình vẽ (tin save) chỉ báo "Không có thay đổi để lưu", không gọi API', async () => {
    const { posted, fromDrawio, saves } = await openEditor(() => jsonResponse(201, { ...version, id: 'v2', seq: 2 }));
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    fromDrawio({ event: 'save', xml: '<mxGraphModel/>' });
    expect(await screen.findByText('Không có thay đổi để lưu.')).toBeInTheDocument();
    expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export"'))).toBe(false);
    expect(saves()).toHaveLength(0);
    // Sửa một nét: nút bật lại.
    fromDrawio({ event: 'autosave', xml: '<mxGraphModel>ĐỔI</mxGraphModel>' });
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('server báo trùng bản mới nhất (unchanged): báo "Không có thay đổi để lưu", không báo "Đã lưu phiên bản", hết dấu chưa lưu', async () => {
    const { posted, fromDrawio, saves } = await openEditor(() => jsonResponse(201, { ...version, unchanged: true }));
    fromDrawio({ event: 'autosave', xml: '<mxGraphModel>KÉO RỒI KÉO LẠI</mxGraphModel>' });
    fromDrawio({ event: 'save', xml: '<mxGraphModel/>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"format":"xml"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: '<mxfile>Y NGUYÊN</mxfile>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"format":"svg"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'svg', data: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}` });
    expect(await screen.findByText('Không có thay đổi để lưu.')).toBeInTheDocument();
    expect(saves()).toHaveLength(1);
    expect(screen.queryByText(/Đã lưu phiên bản/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });
});

describe('Phiên bản dựng tự động chưa có ảnh xem (Dựng lại mặt tủ / Dựng nháp từ sơ đồ cổng)', () => {
  const built = { id: 'v4', seq: 4, summary: 'Dựng lại mặt tủ R1', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };

  it('Xem: nói rõ phiên bản chưa có ảnh xem và cách tạo — không nói "chưa có nội dung"', async () => {
    const node = { ...ROOT, status: 'draft' as const, latestVersion: { id: 'v4', seq: 4, savedAt: '2026-10-03T01:00:00Z', savedBy: 'a' } };
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: node, version: { ...built, xml: '<mxfile/>', svg: null } }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, node),
    });
    renderScreen('/diagrams/d1');
    expect(await screen.findByText('Phiên bản #4 chưa có ảnh xem')).toBeInTheDocument();
    expect(screen.getByText(/mở tab Sửa rồi bấm Lưu/)).toBeInTheDocument();
    expect(screen.queryByText('Bản vẽ chưa có nội dung')).toBeNull();
  });

  it('Sửa: nút Lưu bật ngay dù chưa sửa gì — lưu là cách tạo ảnh xem', async () => {
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...built, xml: '<mxfile/>', svg: null } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
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
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'init' }), source: frame.contentWindow }));
    });
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });
});

describe('Dựng lại mặt tủ khi kho không đổi gì (Q-23 06/10)', () => {
  it('server trả bản mới nhất kèm unchanged → báo không tạo phiên bản mới, không nạp lại khung', async () => {
    const rack = { ...ROOT, nodeType: 'cabinet' as const, cabinetId: 'cab-1' };
    const latest = { id: 'v4', seq: 4, summary: 'Dựng lại mặt tủ R1', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: rack, version: { ...latest, xml: '<mxfile/>', svg: '<svg/>' } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/versions/rebuild-rack': () => jsonResponse(201, { ...latest, unchanged: true }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, rack),
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
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'init' }), source: frame.contentWindow }));
    });
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, /^Dựng lại mặt tủ/);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dựng lại' }));
    expect(await screen.findByText('Mặt tủ dựng từ kho trùng bản mới nhất — không tạo phiên bản mới.')).toBeInTheDocument();
    expect(screen.queryByText(/Đã dựng lại mặt tủ thành nháp/)).toBeNull();
    const contentLoads = fetchMock.mock.calls.filter(([url]) => String(url).includes('/d1/content')).length;
    expect(contentLoads).toBe(1);
  });
});

describe('Lưu trùng bản mới nhất của người khác (Q-23 05/10)', () => {
  it('server trả bản mới nhất #3 (unchanged) → dòng trạng thái nói "Đã lưu #3", lượt sau dựa trên #3', async () => {
    const v1 = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...v1, xml: '<mxfile/>', svg: null } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/versions': () => jsonResponse(201, { ...v1, id: 'v3', seq: 3, savedBy: 'b', savedAt: '2026-10-03T02:00:00Z', unchanged: true }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
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
    const save = async () => {
      fromDrawio({ event: 'autosave', xml: '<mxGraphModel>X</mxGraphModel>' });
      fromDrawio({ event: 'save', xml: '<mxGraphModel/>' });
      await vi.waitFor(() => expect(posted.mock.calls.filter(([d]) => String(d).includes('"format":"xml"')).length).toBeGreaterThan(0));
      fromDrawio({ event: 'export', format: 'xml', xml: '<mxfile>GIỐNG #3</mxfile>' });
      await vi.waitFor(() => expect(posted.mock.calls.filter(([d]) => String(d).includes('"format":"svg"')).length).toBeGreaterThan(0));
      fromDrawio({ event: 'export', format: 'svg', data: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}` });
    };
    await save();
    expect(await screen.findByText(/^Đã lưu #3 · /)).toBeInTheDocument();
    posted.mockClear();
    await save();
    await vi.waitFor(() => expect((fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([u, i]) => String(u).endsWith('/versions') && i?.method === 'POST')).toHaveLength(2));
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .filter(([u, i]) => String(u).endsWith('/versions') && i?.method === 'POST')
      .map(([, i]) => JSON.parse(String(i?.body)) as { basedOnVersionId: string });
    expect(bodies.map((b) => b.basedOnVersionId)).toEqual(['v1', 'v3']);
  });
});

describe('Thanh trình xem nói đang xem bản nào', () => {
  const saved = (id: string, seq: number) => ({ id, seq, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null });

  it('bản nháp mới hơn bản chính thức: "Nháp #2 · chưa phát hành" + nút xem bản chính thức', async () => {
    const node = { ...ROOT, status: 'official_draft' as const, officialSeq: 1, officialVersionId: 'v1', latestVersion: { id: 'v2', seq: 2, savedAt: '2026-10-03T01:00:00Z', savedBy: 'a' } };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content?mode=view&versionId=v1': () => jsonResponse(200, { diagram: node, version: { ...saved('v1', 1), xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: node, version: { ...saved('v2', 2), xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, node),
    });
    renderScreen('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(screen.getByText('Nháp #2 · chưa phát hành')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xem bản chính thức v1' }));
    expect(await screen.findByText('Chính thức v1')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('versionId=v1'))).toBe(true);
  });

  it('chưa phát hành lần nào: chỉ "Nháp #n · chưa phát hành", không có nút xem bản chính thức', async () => {
    const node = { ...ROOT, status: 'draft' as const, latestVersion: { id: 'v3', seq: 3, savedAt: '2026-10-03T01:00:00Z', savedBy: 'a' } };
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: node, version: { ...saved('v3', 3), xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, node),
    });
    renderScreen('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(screen.getByText('Nháp #3 · chưa phát hành')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xem bản chính thức/ })).toBeNull();
  });
});

describe('Thẻ "Bản vẽ đang trống" của chế độ Sửa', () => {
  it('lưu lần đầu xong thẻ KHÔNG hiện lại che bản vẽ vừa lưu (nội dung đã cache vẫn là "chưa có phiên bản")', async () => {
    const saved = { id: 'v1', seq: 1, summary: 'Thêm 3 thiết bị', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: null }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/versions': () => jsonResponse(201, saved),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
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
    expect(screen.getByRole('heading', { name: 'Bản vẽ đang trống — bắt đầu như sau' })).toBeInTheDocument();

    fromDrawio({ event: 'autosave', xml: '<mxGraphModel>3 MÁY</mxGraphModel>' });
    fromDrawio({ event: 'save', xml: '<mxGraphModel/>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"format":"xml"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', xml: '<mxfile>3 MÁY</mxfile>' });
    await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"format":"svg"'))).toBe(true));
    fromDrawio({ event: 'export', format: 'svg', data: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}` });

    expect(await screen.findByText('Đã lưu phiên bản #1: Thêm 3 thiết bị')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bản vẽ đang trống — bắt đầu như sau' })).toBeNull();
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
    '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...VERSION, xml: HAVE_XML, svg: SVG }, deviceCells: [], devices: [] }),
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
    // Sẵn sàng ngay từ `init` (lệnh load đã gửi trước mọi lệnh sau) — không chờ tin `load`. Lưu
    // vẫn tắt tới khi có gì đó đổi (Q-23).
    expect(screen.getByRole('button', { name: 'Thiết bị kho' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
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

  it('đếm kết quả; "Chọn tất cả (n)" chỉ chọn máy chèn được; máy đã có mang nhãn "Đã có trên bản vẽ" (E-08)', async () => {
    await openEditor();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    const box = screen.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
    expect(await within(box).findByText('2 Thiết bị khớp')).toBeInTheDocument();
    expect(within(box).getByText('Đã có trên bản vẽ')).toHaveClass('badge');
    await user.click(within(box).getByRole('button', { name: 'Chọn tất cả (1)' }));
    expect(within(box).getByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' })).toBeChecked();
    expect(within(box).getByRole('button', { name: 'Chèn 1 thiết bị' })).toBeEnabled();
    await user.click(within(box).getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(within(box).getByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' })).not.toBeChecked();
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

describe('Kéo máy từ "Thiết bị kho" thả vào trình vẽ (Q-23 06/10)', () => {
  /** DataTransfer tối thiểu: jsdom không có. */
  function transfer() {
    const data = new Map<string, string>();
    return { data, setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', effectAllowed: 'all', dropEffect: 'none' };
  }

  async function readyRow(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    const box = screen.getByRole('dialog', { name: 'Chèn thiết bị có trong kho' });
    const row = (await within(box).findByRole('checkbox', { name: 'Chọn SW-E2E-OK để chèn' })).closest('li') as HTMLLIElement;
    // Chuột vào dòng → đọc trước ô của máy; xong thì dòng mới kéo được.
    expect(row.getAttribute('draggable')).toBe('false');
    await user.hover(row);
    await vi.waitFor(() => expect(row.getAttribute('draggable')).toBe('true'));
    return { box, row };
  }

  it('dữ liệu kéo là <mxGraphModel> một ô đúng ô server dựng — draw.io tự đặt ở chỗ thả; draw.io nhận thì báo "Đã chèn" khi autosave mang máy về', async () => {
    const { posted, fromDrawio } = await openEditor();
    const user = userEvent.setup();
    const { row, box } = await readyRow(user);
    // Máy đã có trên bản vẽ không kéo được.
    expect(within(box).getByRole('checkbox', { name: 'Chọn SW-E2E-HAVE để chèn' }).closest('li')?.getAttribute('draggable')).toBe('false');
    const dt = transfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    const xml = dt.data.get('text/plain') ?? '';
    expect(xml.startsWith('<mxGraphModel>')).toBe(true);
    expect(xml).toContain('ims_device_id="dev-ok"');
    expect(xml).toContain('style="align=center;shape=mxgraph.networks.switch;html=0;"');
    expect(dt.effectAllowed).toBe('copy');
    // draw.io nhận cú thả (dropEffect copy) → không chèn thêm; autosave mang máy về → lời báo.
    dt.dropEffect = 'copy';
    fireEvent.dragEnd(row, { dataTransfer: dt });
    fromDrawio({ event: 'autosave', xml: HAVE_XML.replace('</root>', '<UserObject label="SW-E2E-OK" ims_device_id="dev-ok" ims_device_code="SW-E2E-OK" id="n1"><mxCell vertex="1" parent="1"><mxGeometry x="300" y="200" width="100" height="30" as="geometry"/></mxCell></UserObject></root>') });
    expect(await screen.findByText('Đã chèn SW-E2E-OK vào bản vẽ.')).toBeInTheDocument();
    expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"patch"'))).toBe(false);
  });

  it('thả vào khung mà trình duyệt không giao cú thả (dropEffect none) → IMS chèn theo lưới, báo rõ', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { posted, fromDrawio } = await openEditor();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { row } = await readyRow(user);
      const dt = transfer();
      fireEvent.dragStart(row, { dataTransfer: dt });
      // Con trỏ rời trang IMS vào trong khung (jsdom: khung ở 0,0 cỡ 0 — điểm 0,0 nằm trong khung).
      // jsdom không có DragEvent: MouseEvent mang đủ toạ độ + relatedTarget như trình duyệt gửi.
      document.body.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, clientX: 0, clientY: 0, relatedTarget: null }));
      fireEvent.dragEnd(row, { dataTransfer: dt });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'))).toBe(true));
      fromDrawio({ event: 'export', format: 'xml', xml: HAVE_XML, currentPage: 0 });
      await vi.waitFor(() => expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"patch"'))).toBe(true));
      expect(await screen.findByText(/Đã chèn SW-E2E-OK cạnh các hình đang có/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('kéo rồi thả lại trong hộp (không vào khung) → không chèn gì', async () => {
    const { posted } = await openEditor();
    const user = userEvent.setup();
    const { row } = await readyRow(user);
    const dt = transfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.dragEnd(row, { dataTransfer: dt });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(posted.mock.calls.some(([data]) => String(data).includes('"action":"export","format":"xml"'))).toBe(false);
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

describe('Bản vẽ đã lưu trữ — chỉ xem (Q-23, 05/10)', () => {
  it('?mode=edit vẫn mở chế độ xem, không có tab Sửa, có dải "Bản vẽ đã lưu trữ — chỉ xem"', async () => {
    const shelved = node('d9', null, 'Tầng cũ E2E', { archivedAt: '2026-10-01T03:00:00Z' });
    const version = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d9/content': () => jsonResponse(200, { diagram: shelved, version: { ...version, xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d9': () => jsonResponse(200, shelved),
    });
    renderScreen('/diagrams/d9?mode=edit');
    expect(await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeInTheDocument();
    expect(screen.getByRole('note', { name: 'Bản vẽ đã lưu trữ' })).toHaveTextContent('Bản vẽ đã lưu trữ — chỉ xem.');
    expect(screen.queryByRole('tab', { name: 'Sửa' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('mode=edit'))).toBe(true);
  });
});

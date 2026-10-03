import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
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

  it('màn hẹp (< 1024px) ở chế độ sửa: báo "chỉ làm trên máy tính", không tải nội dung, có lối sang xem', async () => {
    narrow(true);
    const fetchMock = routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    });
    renderScreen('/diagrams/d1?mode=edit');
    expect(await screen.findByText('Sửa sơ đồ chỉ làm trên máy tính')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sang chế độ xem' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content'))).toBe(false);
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
    ['Thành viên chỉ thêm bản vẽ con', MEMBER, ['Thêm bản vẽ con']],
    ['SA đổi tên / chuyển nhánh / lưu trữ được', ME, ['Thêm bản vẽ con', 'Đổi tên / chuyển nhánh', 'Lưu trữ']],
  ])('%s', async (_name, me, expected) => {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, [ROOT]) });
    renderScreen('/diagrams', me);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thao tác với Tổng công ty E2E' }));
    expect((await screen.findAllByRole('menuitem')).map((el) => el.textContent)).toEqual(expected);
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
    fromDrawio({ event: 'save', xml: '<mxfile>NÉT ĐANG VẼ</mxfile>' });
    fromDrawio({ event: 'export', data: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}` });

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
    const exports = posted.mock.calls.filter(([data]) => String(data).includes('"action":"export"'));
    expect(exports).toHaveLength(1);
  });
});

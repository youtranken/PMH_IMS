import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

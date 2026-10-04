import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramTreeScreen } from './diagram-tree-screen';

/*
 * Q-23 góp ý 04/10: màn sơ đồ phải "nhìn vào là biết dùng" — mỗi việc trên thanh có (i) giải thích
 * một dòng, mỗi mục ⋮ có dòng mô tả, có mục "Hướng dẫn", màn trống có các bước gợi ý.
 */

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const VERSION = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'sa@e2e.local', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><g data-cell-id="s1"><text>Core E2E</text></g></svg>';

function node(extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'd1',
    parentId: null,
    name: 'Tổng công ty E2E',
    nodeType: 'company',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    kind: 'official',
    archivedAt: null,
    status: 'draft',
    latestVersion: { id: 'v1', seq: 1, savedAt: '2026-10-03T01:00:00Z', savedBy: 'sa@e2e.local' },
    officialSeq: null,
    pendingApprovalId: null,
    ...extra,
  };
}

function routeFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit]() : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/diagrams', element: <DiagramTreeScreen me={SA} /> },
      { path: '/diagrams/:id', element: <DiagramScreen me={SA} /> },
    ],
    { initialEntries: [path] },
  );
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('màn sơ đồ tự giải thích', () => {
  it('chế độ Xem: việc trên thanh có (i); mục ⋮ có dòng mô tả; "Hướng dẫn" mở hộp giải thích', async () => {
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: node(), version: { ...VERSION, xml: '<mxfile/>', svg: SVG } }),
      '/api/v1/diagrams/d1/comments': () => jsonResponse(200, []),
      '/api/v1/diagrams/d1/review': () => jsonResponse(200, null),
      '/api/v1/diagrams/d1': () => jsonResponse(200, node()),
    });
    renderAt('/diagrams/d1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup();
    for (const subject of ['Tìm', 'Phát hành']) {
      expect(await screen.findByRole('button', { name: `Giải thích: ${subject}` })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Giải thích: Phát hành' }));
    expect(screen.getByText(/thành bản chính thức/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Thao tác với/ }));
    expect(await screen.findByRole('menuitem', { name: 'Kiểm tra khớp' })).toHaveTextContent('So bản vẽ với dữ liệu kho');
    await user.click(screen.getByRole('menuitem', { name: 'Hướng dẫn' }));
    const guide = await screen.findByRole('dialog', { name: 'Hướng dẫn dùng sơ đồ mạng' });
    for (const part of ['Xem và Sửa', 'Vẽ dây là khai kết nối', 'Khung', 'Phiên bản và duyệt']) {
      expect(within(guide).getByRole('heading', { name: part })).toBeInTheDocument();
    }
  });

  it('chế độ Sửa, bản vẽ chưa có gì: các bước bắt đầu đánh số; vẽ nét đầu tiên thì ẩn', async () => {
    const empty = node({ status: 'empty', latestVersion: null });
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: empty, version: null }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1/comments': () => jsonResponse(200, []),
      '/api/v1/diagrams/d1/review': () => jsonResponse(200, null),
      '/api/v1/diagrams/d1': () => jsonResponse(200, empty),
    });
    renderAt('/diagrams/d1?mode=edit');
    const frame = (await screen.findByTitle('Khung vẽ draw.io')) as HTMLIFrameElement;
    const steps = await screen.findByRole('list', { name: 'Các bước bắt đầu' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Thiết bị kho');
    expect(items[1]).toHaveTextContent('kéo dây');
    expect(items[2]).toHaveTextContent('Lưu');
    expect(items[3]).toHaveTextContent(/Phát hành|Gửi duyệt/);
    expect(screen.getByRole('button', { name: 'Giải thích: Thiết bị kho' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giải thích: Lưu' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ event: 'autosave', xml: '<mxfile/>' }), source: frame.contentWindow }),
      );
    });
    expect(screen.queryByRole('list', { name: 'Các bước bắt đầu' })).toBeNull();
  });

  it('cây trống: các bước bắt đầu thay cho một câu', async () => {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, []) });
    renderAt('/diagrams');
    const steps = await screen.findByRole('list', { name: 'Các bước bắt đầu' });
    expect(within(steps).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(steps).toHaveTextContent('Thêm bản vẽ');
  });
});

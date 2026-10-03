import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within, pickMenuItem } from '@/test/test-utils';
import type { CompareView, DiagramNode, ReviewPage, VersionItem } from './diagram-api';
import { DiagramScreen } from './diagram-screen';

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const MEMBER = { id: 'u2', email: 'member@e2e.local', fullName: 'Thành viên E2E', role: 'member', csrfToken: 'c' } as unknown as Me;

function item(id: string, seq: number): VersionItem {
  return { id, seq, summary: `bản ${seq}`, label: null, savedBy: 'member@e2e.local', savedByName: null, savedAt: '2026-09-01T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="1">' +
  '<g data-cell-id="n1"><rect width="10" height="10"/><text>Mới E2E</text></g>' +
  '<g data-cell-id="c1"><text>Đổi E2E</text></g></g></svg>';

const NODE: DiagramNode = {
  id: 'g1',
  parentId: null,
  name: 'Tầng 3 E2E',
  nodeType: 'floor',
  siteId: null,
  cabinetId: null,
  ownerEmail: null,
  kind: 'official',
  archivedAt: null,
  status: 'official_draft',
  latestVersion: { id: 'v3', seq: 3, savedAt: '2026-10-03T01:00:00Z', savedBy: 'member@e2e.local' },
  officialSeq: 2,
  pendingApprovalId: null,
};

const COMPARE: CompareView = {
  from: { id: 'v1', seq: 1 },
  to: { id: 'v3', seq: 3, savedAt: '2026-10-03T01:00:00Z', svg: SVG },
  result: {
    added: [{ id: 'n1', label: 'Mới E2E' }],
    removed: [{ id: 'r1', label: 'SW-E2E-BỎ', bounds: { x: 10, y: 10, width: 80, height: 40 } }],
    changed: [{ id: 'c1', label: 'Đổi E2E', reasons: ['label'] }],
    anchors: [],
  },
  counts: { added: 1, removed: 1, changed: 1 },
};

type Handler = (init?: RequestInit, url?: string) => Response;

function routeFetch(routes: [string, Handler][]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = routes.find(([path]) => url.includes(path));
    return Promise.resolve(hit ? hit[1](init, url) : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function contentOf(url = '') {
  const id = /versionId=(v\d)/.exec(url)?.[1] ?? 'v3';
  const seq = Number(id.slice(1));
  return jsonResponse(200, { diagram: NODE, version: { ...item(id, seq), xml: '<mxfile/>', svg: SVG }, deviceCells: [], devices: [] });
}

function base(extra: [string, Handler][] = [], review: ReviewPage | null = null): [string, Handler][] {
  return [
    ...extra,
    ['/api/v1/diagrams/editor-settings', () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 })],
    ['/api/v1/diagrams/g1/content', (_init, url) => contentOf(url)],
    ['/api/v1/diagrams/g1/comments', () => jsonResponse(200, [])],
    ['/api/v1/diagrams/g1/review', () => jsonResponse(200, review)],
    [
      '/api/v1/diagrams/g1/publications',
      () =>
        jsonResponse(200, {
          officialVersionId: 'v2',
          publishedVersionIds: ['v1', 'v2'],
          events: [
            { versionId: 'v1', seq: 1, at: '2026-09-01T03:00:00Z' },
            { versionId: 'v2', seq: 2, at: '2026-09-20T03:00:00Z' },
          ],
        }),
    ],
    ['/api/v1/diagrams/g1/versions', () => jsonResponse(200, [item('v3', 3), item('v2', 2), item('v1', 1)])],
    ['/api/v1/diagrams/g1', () => jsonResponse(200, NODE)],
  ];
}

let where = '';
function Where() {
  const location = useLocation();
  where = location.pathname + location.search;
  return null;
}

function renderScreen(path: string, me: Me = SA) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <Where />
          <Routes>
            <Route path="/diagrams/:id" element={<DiagramScreen me={me} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-03T03:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Xuất PNG/PDF (FR-044)', () => {
  it('Thành viên xuất PDF phiên bản đang xem: POST kèm CSRF, file lưu xuống máy', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const fetchMock = routeFetch(
      base([
        [
          '/api/v1/diagrams/g1/versions/v3/exports',
          () => new Response(new Blob(['%PDF-1.7']), { status: 200, headers: { 'content-disposition': "attachment; filename*=UTF-8''T%E1%BA%A7ng%203%20E2E%20-%20v3.pdf" } }),
        ],
      ]),
    );
    renderScreen('/diagrams/g1', MEMBER);
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await pickMenuItem(user, /^Thao tác với/, 'Xuất');
    await user.click(await screen.findByRole('button', { name: 'Xuất PDF' }));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/exports'));
    expect(call).toBeTruthy();
    const init = call![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"format":"pdf"}');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('c');
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('hết ân hạn sơ đồ: hỏi mã tại chỗ; huỷ thì không gọi lại, không báo lỗi', async () => {
    const fetchMock = routeFetch(
      base([['/api/v1/diagrams/g1/versions/v3/exports', () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })]]),
    );
    renderScreen('/diagrams/g1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await pickMenuItem(user, /^Thao tác với/, 'Xuất');
    await user.click(await screen.findByRole('button', { name: 'Xuất PNG' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận danh tính' });
    expect(dialog).toHaveTextContent('Nhập mã 6 số để xuất bản vẽ "Tầng 3 E2E".');
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/exports'))).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('So sánh hai phiên bản (Q-23)', () => {
  it('?compare=: tô màu trên ảnh của bản sau, chú giải + bộ đếm, thoát về xem bản đó; không tải nội dung lần hai', async () => {
    const fetchMock = routeFetch(base([['/api/v1/diagrams/g1/compare', () => jsonResponse(200, COMPARE)]]));
    const { container } = renderScreen('/diagrams/g1?version=v3&compare=v1');
    const viewer = await screen.findByRole('region', { name: 'Bản vẽ, so sánh hai phiên bản' });
    expect(container.querySelector('[data-cell-id="n1"]')?.getAttribute('data-ims-diff')).toBe('added');
    expect(within(viewer).getByRole('group', { name: 'Chú giải so sánh' })).toHaveTextContent('Thêm 1');
    expect(within(viewer).getByRole('img', { name: 'Đã bỏ: SW-E2E-BỎ' })).toBeInTheDocument();
    expect(screen.getByText(/So sánh phiên bản #1 → #3/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/compare?from=v1&to=v3'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content'))).toBe(false);
    await userEvent.setup({ advanceTimers: () => undefined }).click(screen.getByRole('button', { name: 'Thoát so sánh' }));
    expect(where).toBe('/diagrams/g1?version=v3');
  });

  it('hộp phiên bản: đánh dấu hai phiên bản → "So sánh" mở trình xem so sánh, bản cũ hơn làm gốc', async () => {
    routeFetch(base([['/api/v1/diagrams/g1/compare', () => jsonResponse(200, COMPARE)]]));
    renderScreen('/diagrams/g1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await pickMenuItem(user, /^Thao tác với/, 'Phiên bản');
    const dialog = await screen.findByRole('dialog', { name: 'Phiên bản và lịch sử' });
    const go = within(dialog).getByRole('button', { name: 'So sánh 2 phiên bản đã chọn' });
    expect(go).toBeDisabled();
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Chọn phiên bản #3 để so sánh' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Chọn phiên bản #1 để so sánh' }));
    await user.click(go);
    expect(where).toBe('/diagrams/g1?version=v3&compare=v1');
  });

  it('trang duyệt: "Xem so sánh với bản chính thức" mở so sánh bản chính thức → bản chờ duyệt', async () => {
    const review: ReviewPage = {
      approval: { id: 'a1', state: 'pending', requester: 'member@e2e.local', requesterName: 'Thành viên E2E', reason: 'Thêm máy', createdAt: '2026-10-03T01:00:00Z' },
      versionId: 'v3',
      seq: 3,
      officialSeq: 2,
      officialVersionId: 'v2',
      summary: 'Thêm 1 thiết bị',
      errors: [],
      warnings: [],
    };
    const routes = base([['/api/v1/diagrams/g1/compare', () => jsonResponse(200, COMPARE)]], review);
    // Đường chung của nút (khớp sau cùng) trả bản vẽ đang chờ duyệt.
    routes[routes.length - 1] = ['/api/v1/diagrams/g1', () => jsonResponse(200, { ...NODE, status: 'pending', pendingApprovalId: 'a1' })];
    routeFetch(routes);
    renderScreen('/diagrams/g1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await user.click(await screen.findByRole('button', { name: 'Duyệt…' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Xem so sánh với bản chính thức' }));
    expect(where).toBe('/diagrams/g1?version=v3&compare=v2');
  });
});

describe('Thanh trượt thời gian', () => {
  it('kéo về một ngày → xem bản chính thức hiệu lực ngày đó; trước bản đầu tiên → "chưa có"', async () => {
    const fetchMock = routeFetch(base());
    renderScreen('/diagrams/g1');
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    const user = userEvent.setup({ advanceTimers: () => undefined });
    await pickMenuItem(user, /^Thao tác với/, 'Dòng thời gian');
    const slider = await screen.findByRole('slider', { name: 'Chọn ngày' });
    // Thang bắt đầu từ 31/08 (hôm trước lần phát hành đầu): nấc 5 = 05/09 → bản chính thức #1.
    fireEvent.change(slider, { target: { value: '5' } });
    expect(where).toBe('/diagrams/g1?version=v1&at=2026-09-05');
    expect((await screen.findAllByText(/Bản chính thức hiệu lực ngày 05\/09\/2026 — phiên bản 1/)).length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/content?mode=view&versionId=v1'))).toBe(true));

    fireEvent.change(await screen.findByRole('slider', { name: 'Chọn ngày' }), { target: { value: '0' } });
    expect(where).toBe('/diagrams/g1?at=2026-08-31');
    // Màn (và hộp thanh trượt) báo chưa có; không tải nội dung nào cho ngày đó.
    expect((await screen.findAllByText('Chưa có bản chính thức vào ngày này')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Bản vẽ, chỉ xem' })).toBeNull();
  });
});

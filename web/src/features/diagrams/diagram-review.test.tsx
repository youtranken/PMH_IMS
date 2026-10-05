import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within, pickMenuItem } from '@/test/test-utils';
import type { CommentThread, DiagramNode, ReviewPage } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramTreeScreen } from './diagram-tree-screen';

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const MEMBER = { id: 'u2', email: 'member@e2e.local', fullName: 'Thành viên E2E', role: 'member', csrfToken: 'c' } as unknown as Me;

const VERSION = { id: 'v2', seq: 2, summary: 'x', label: null, savedBy: 'member@e2e.local', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g data-cell-id="1">' +
  '<g data-cell-id="d1"><rect width="10" height="10"/><text>SW-E2E-01</text></g>' +
  '<g data-cell-id="s1"><text>Tầng 3</text></g></g></svg>';

function diagram(extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'g1',
    parentId: null,
    name: 'Tầng 3 E2E',
    nodeType: 'floor',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    kind: 'official',
    archivedAt: null,
    status: 'draft',
    latestVersion: { id: 'v2', seq: 2, savedAt: '2026-10-03T01:00:00Z', savedBy: 'member@e2e.local' },
    officialSeq: null,
    pendingApprovalId: null,
    ...extra,
  };
}

type Handler = (init?: RequestInit) => Response;

/** Đường cụ thể khai TRƯỚC đường chung: khớp theo chuỗi con, đường đầu tiên khớp thắng. */
function routeFetch(routes: [string, Handler][]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = routes.find(([path]) => url.includes(path));
    return Promise.resolve(hit ? hit[1](init) : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function base(node: DiagramNode, comments: CommentThread[] = [], review?: ReviewPage): [string, Handler][] {
  return [
    ['/api/v1/diagrams/editor-settings', () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 })],
    [
      '/api/v1/diagrams/g1/content',
      () =>
        jsonResponse(200, {
          diagram: node,
          version: { ...VERSION, xml: '<mxfile/>', svg: SVG },
          deviceCells: [],
          devices: [],
          cells: [
            { id: 'd1', kind: 'device', layer: '1', bounds: null, label: 'SW-E2E-01' },
            { id: 's1', kind: 'shape', layer: '1', bounds: null, label: 'Tầng 3' },
          ],
        }),
    ],
    ['/api/v1/diagrams/g1/comments', () => jsonResponse(200, comments)],
    ['/api/v1/diagrams/g1/review', () => jsonResponse(200, review ?? null)],
    ['/api/v1/diagrams/g1', () => jsonResponse(200, node)],
  ];
}

function posted(fetchMock: ReturnType<typeof routeFetch>, path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).includes(path) && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body ?? 'null')) as unknown);
}

/** Chờ trình xem hiện (nội dung đã tải) — thanh trên dựng lại một lần khi nội dung về. */
async function viewerReady() {
  await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
}

function renderScreen(path: string, me: Me) {
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

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe('Gửi duyệt (Thành viên) và tự kiểm', () => {
  it('Thành viên thấy "Gửi duyệt", không thấy "Phát hành"; lý do bắt buộc; gửi đúng lý do', async () => {
    const fetchMock = routeFetch([
      ['/api/v1/diagrams/g1/submit', () => jsonResponse(200, { approval: { id: 'a1' }, warnings: [] })],
      ...base(diagram()),
    ]);
    renderScreen('/diagrams/g1', MEMBER);
    await viewerReady();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gửi duyệt' }));
    expect(screen.queryByRole('button', { name: 'Phát hành' })).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: 'Gửi bản vẽ "Tầng 3 E2E" cho Admin duyệt' });
    await user.click(within(dialog).getByRole('button', { name: 'Gửi duyệt' }));
    expect(within(dialog).getByText('Không được để trống.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Lý do/), 'Vẽ xong tầng 3');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi duyệt' }));
    expect(await screen.findByText('Đã gửi duyệt. Admin sẽ nhận email.')).toBeInTheDocument();
    expect(posted(fetchMock, '/g1/submit')).toEqual([{ reason: 'Vẽ xong tầng 3' }]);
  });

  it('nháp mới nhất do người khác lưu: Thành viên không có "Gửi duyệt" (D-04)', async () => {
    const node = diagram({ latestVersion: { id: 'v2', seq: 2, savedAt: '2026-10-03T01:00:00Z', savedBy: 'sa@e2e.local' } });
    routeFetch(base(node));
    renderScreen('/diagrams/g1', MEMBER);
    await viewerReady();
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).toBeNull();
  });

  it('lỗi đỏ chặn: hộp liệt kê lỗi + cảnh báo, có nút xem trên bản vẽ', async () => {
    routeFetch([
      [
        '/api/v1/diagrams/g1/submit',
        () =>
          jsonResponse(400, {
            code: 'DIAGRAM_CHECK_FAILED',
            message: 'Bản vẽ còn 1 lỗi',
            errors: [{ level: 'error', code: 'DEVICE_RETIRED', cellId: 'd1', message: 'Thiết bị SW-E2E-01 đã thanh lý nhưng vẫn nằm trên bản vẽ.' }],
            warnings: [{ level: 'warning', code: 'DEVICE_CABINET_MISMATCH', cellId: 'd2', message: 'Thiết bị SW-E2E-02 nằm trong khung tủ khác.' }],
          }),
      ],
      ...base(diagram()),
    ]);
    renderScreen('/diagrams/g1', MEMBER);
    await viewerReady();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gửi duyệt' }));
    const dialog = await screen.findByRole('dialog', { name: /cho Admin duyệt/ });
    await user.type(within(dialog).getByLabelText(/Lý do/), 'Gửi');
    await user.click(within(dialog).getByRole('button', { name: 'Gửi duyệt' }));
    const found = await screen.findByRole('dialog', { name: 'Tự kiểm còn lỗi đỏ' });
    expect(found).toHaveTextContent('đã thanh lý nhưng vẫn nằm trên bản vẽ');
    expect(found).toHaveTextContent('nằm trong khung tủ khác');
    expect(within(found).getByRole('button', { name: 'Xem trên bản vẽ' })).toBeInTheDocument();
  });
});

describe('Phát hành (Admin/SA)', () => {
  it('SA bấm Phát hành → hỏi xác nhận → gửi; lưu không tự phát hành', async () => {
    const fetchMock = routeFetch([['/api/v1/diagrams/g1/publish', () => jsonResponse(200, { versionId: 'v2', seq: 2, warnings: [] })], ...base(diagram())]);
    renderScreen('/diagrams/g1', SA);
    await viewerReady();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Phát hành' }));
    const confirm = await screen.findByRole('dialog', { name: 'Phát hành phiên bản #2 thành bản chính thức?' });
    await user.click(within(confirm).getByRole('button', { name: 'Phát hành' }));
    expect(await screen.findByText('Phiên bản #2 đã là bản chính thức.')).toBeInTheDocument();
    expect(posted(fetchMock, '/g1/publish')).toEqual([{}]);
  });
});

describe('Yêu cầu đang chờ', () => {
  const REVIEW: ReviewPage = {
    approval: { id: 'a1', state: 'pending', requester: 'member@e2e.local', requesterName: 'Thành viên E2E', reason: 'Vẽ xong tầng 3', createdAt: '2026-10-03T02:00:00Z' },
    versionId: 'v2',
    seq: 2,
    officialSeq: 1,
    officialVersionId: 'v1',
    summary: 'Thêm 1 thiết bị',
    errors: [],
    warnings: [{ level: 'warning', code: 'DEVICE_CABINET_MISMATCH', cellId: 'd1', message: 'Thiết bị SW-E2E-01 nằm trong khung tủ khác.' }],
  };
  const PENDING = diagram({ status: 'pending', pendingApprovalId: 'a1', officialSeq: 1 });

  it('Admin mở trang duyệt: tóm tắt một dòng + cảnh báo + nút so sánh (bấm được khi có bản chính thức); Trả về kèm ghi chú', async () => {
    const fetchMock = routeFetch([['/api/v1/diagrams/g1/review/a1/return', () => jsonResponse(200, { state: 'returned' })], ...base(PENDING, [], REVIEW)]);
    renderScreen('/diagrams/g1', SA);
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Gửi duyệt' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Duyệt…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Duyệt phiên bản #2' });
    expect(dialog).toHaveTextContent('Thay đổi so với bản chính thức v1');
    expect(dialog).toHaveTextContent('Thêm 1 thiết bị');
    expect(dialog).toHaveTextContent('nằm trong khung tủ khác');
    expect(within(dialog).getByRole('button', { name: 'Xem so sánh với bản chính thức' })).toBeEnabled();
    await user.type(within(dialog).getByLabelText('Ghi chú chung'), 'Thiếu dây uplink');
    await user.click(within(dialog).getByRole('button', { name: 'Trả về' }));
    expect(await screen.findByText('Đã trả về. Người gửi nhận email kèm ghi chú.')).toBeInTheDocument();
    expect(posted(fetchMock, '/review/a1/return')).toEqual([{ note: 'Thiếu dây uplink' }]);
  });

  it('người gửi thấy "Rút yêu cầu", không thấy nút duyệt (không tự duyệt)', async () => {
    routeFetch(base(PENDING, [], REVIEW));
    renderScreen('/diagrams/g1', { ...SA, email: 'member@e2e.local' } as Me);
    await userEvent.setup().click(await screen.findByRole('button', { name: /^Thao tác với/ }));
    expect(await screen.findByRole('menuitem', { name: 'Rút yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Duyệt…' })).toBeNull();
  });
});

describe('Ghim bình luận', () => {
  const THREAD: CommentThread = {
    id: 'c1',
    versionId: 'v2',
    approvalId: 'a1',
    parentId: null,
    kind: 'note',
    cellId: 'gone',
    anchor: { x: 30, y: 40 },
    body: 'Sai cổng uplink',
    author: 'sa@e2e.local',
    authorName: 'SA E2E',
    createdAt: '2026-10-03T03:00:00Z',
    versionSeq: 1,
    cellKind: null,
    cellLabel: null,
    resolved: false,
    replies: [],
  };
  const ON_DEVICE: CommentThread = {
    ...THREAD,
    id: 'c2',
    cellId: 'd1',
    cellKind: 'device',
    cellLabel: 'SW-E2E-01',
    body: 'Cổng uplink cắm nhầm sang Gi1/0/48, đổi lại giúp',
    replies: [{ ...THREAD, id: 'r1', parentId: 'c2', cellId: 'd1', body: 'Đã đổi' }],
  };

  it('ghim hiện trên trình xem (ô đã bỏ → "(hình đã bỏ)"); bấm mở luồng, Đã xử lý ghi sự kiện', async () => {
    const fetchMock = routeFetch([['/api/v1/diagrams/g1/comments/c1/resolve', () => jsonResponse(200, { ok: true })], ...base(diagram(), [THREAD])]);
    renderScreen('/diagrams/g1', MEMBER);
    const user = userEvent.setup();
    const pin = await screen.findByRole('button', { name: /Ghim 1 trên hình đã bỏ: Sai cổng uplink \(hình đã bỏ\)/ });
    await user.click(pin);
    const dialog = await screen.findByRole('dialog', { name: 'Ghim trên hình đã bỏ' });
    expect(dialog).toHaveTextContent('Sai cổng uplink');
    await user.click(within(dialog).getByRole('button', { name: 'Đã xử lý' }));
    expect(posted(fetchMock, '/comments/c1/resolve')).toEqual([{ resolved: true }]);
  });

  it('danh sách ghim mở từ thanh trên; chế độ ghim: bấm một hình → ghim bình luận vào ô đó', async () => {
    const fetchMock = routeFetch([...base(diagram(), [THREAD])]);
    renderScreen('/diagrams/g1', SA);
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Ghim (1)');
    const list = await screen.findByRole('list', { name: 'Ghim bình luận trên bản vẽ' });
    expect(list).toHaveTextContent('Sai cổng uplink');
    expect(list).toHaveTextContent('trên hình đã bỏ');
    expect(list).not.toHaveTextContent('gone');
    await user.keyboard('{Escape}');
    await pickMenuItem(user, /^Thao tác với/, 'Ghim bình luận');
    await user.click(screen.getByText('Tầng 3'));
    const dialog = await screen.findByRole('dialog', { name: 'Ghim bình luận lên Tầng 3' });
    await user.type(within(dialog).getByLabelText(/Bình luận/), 'Đặt tên phòng');
    await user.click(within(dialog).getByRole('button', { name: 'Ghim' }));
    expect(await screen.findByText('Đã ghim bình luận.')).toBeInTheDocument();
    expect(posted(fetchMock, '/g1/comments')).toEqual([{ versionId: 'v2', cellId: 's1', anchor: null, body: 'Đặt tên phòng' }]);
  });

  it('ghim trên máy: dấu trên bản vẽ hiện số bình luận + chữ bình luận, gọi máy bằng mã chứ không id ô', async () => {
    routeFetch([...base(diagram(), [ON_DEVICE])]);
    renderScreen('/diagrams/g1', MEMBER);
    const user = userEvent.setup();
    const pin = await screen.findByRole('button', { name: /^Ghim 1 trên SW-E2E-01: Cổng uplink cắm nhầm.* · 2 Bình luận$/ });
    // Chữ hiện ngay trên bản vẽ, không phải bấm mới thấy (Q-23).
    expect(pin).toHaveTextContent('2');
    expect(pin).toHaveTextContent('Cổng uplink cắm nhầm');
    await user.click(pin);
    const dialog = await screen.findByRole('dialog', { name: 'Ghim trên SW-E2E-01' });
    expect(dialog).toHaveTextContent('Cổng uplink cắm nhầm sang Gi1/0/48, đổi lại giúp');
    expect(dialog).toHaveTextContent('Đã đổi');
  });
});

describe('Bản đồ — trạng thái duyệt', () => {
  it('"Chờ duyệt" và "Chính thức v3" (chữ, không chỉ màu)', async () => {
    routeFetch([
      ['/versions', () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })],
      ['/publications', () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })],
      [
        '/api/v1/diagrams',
        () =>
          jsonResponse(200, [
            diagram({ id: 'g0', name: 'Gốc E2E', status: 'empty', latestVersion: null }),
            diagram({ id: 'g1', parentId: 'g0', name: 'A E2E', status: 'pending', pendingApprovalId: 'a1' }),
            diagram({ id: 'g2', parentId: 'g0', name: 'B E2E', status: 'official', officialSeq: 3 }),
            diagram({ id: 'g3', parentId: 'g0', name: 'C E2E', status: 'official_draft', officialSeq: 3 }),
          ]),
      ],
    ]);
    renderScreen('/diagrams?node=g0', SA);
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(within(map).getByRole('button', { name: /^A E2E/ })).toHaveTextContent('Chờ duyệt');
    expect(within(map).getByRole('button', { name: /^B E2E/ })).toHaveTextContent('Chính thức v3');
    expect(within(map).getByRole('button', { name: /^C E2E/ })).toHaveTextContent('Chính thức v3 · có bản nháp');
  });
});

describe('Thanh mảnh (Q-23 một dòng, Q-18 việc chính ngoài, còn lại vào ⋮)', () => {
  it('SA chế độ Xem: chỉ "Phát hành" đứng ngoài; Gửi duyệt, ghim, Kiểm tra khớp, Xuất, Dòng thời gian, Phiên bản nằm trong menu', async () => {
    routeFetch(base(diagram()));
    renderScreen('/diagrams/g1', SA);
    await viewerReady();
    expect(await screen.findByRole('button', { name: 'Phát hành' })).toBeInTheDocument();
    for (const name of ['Gửi duyệt', 'Xuất', 'Dòng thời gian', 'Phiên bản', 'Kiểm tra khớp', 'Ghim bình luận']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thao tác với Tầng 3 E2E' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? item.textContent);
    for (const name of ['Gửi duyệt', 'Ghim bình luận', 'Ghim (0)', 'Kiểm tra khớp', 'Xuất', 'Dòng thời gian', 'Phiên bản']) {
      expect(items.some((label) => label?.startsWith(name))).toBe(true);
    }
  });
});

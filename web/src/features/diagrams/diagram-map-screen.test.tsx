import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { DiagramNode, VersionItem } from './diagram-api';
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
    createdBy: 'sa@e2e.local',
    kind: 'official',
    archivedAt: null,
    status: 'empty',
    latestVersion: null,
    ...extra,
  };
}

const saved = (seq: number, by = 'Thuận') => ({ id: `v${seq}`, seq, savedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), savedBy: 'thuan@x', savedByName: by });

/** Toàn công ty → Tầng 1 (Lễ tân), Tầng 2 (Phòng server ▸ Tủ R1; Kế toán). */
const ROOT = node('d1', null, 'Toàn công ty E2E', { status: 'official', officialSeq: 8, officialVersionId: 'v8', latestVersion: saved(8), versionCount: 8 });
const T1 = node('t1', 'd1', 'Tầng 1 E2E', { status: 'official', officialSeq: 5, officialVersionId: 'v5', latestVersion: saved(5) });
const T2 = node('t2', 'd1', 'Tầng 2 E2E', { status: 'official_draft', officialSeq: 9, officialVersionId: 'v9', latestVersion: saved(10), draftCount: 1 });
const LT = node('lt', 't1', 'Lễ tân E2E', { status: 'official', officialSeq: 3, officialVersionId: 'v3', latestVersion: saved(3), driftCount: 1 });
const SV = node('sv', 't2', 'Phòng server E2E', {
  nodeType: 'room',
  status: 'official_draft',
  officialSeq: 12,
  officialVersionId: 'v12',
  latestVersion: saved(15),
  versionCount: 15,
  draftCount: 3,
  stats: { devices: 24, cables: 41, cabinets: 2 },
  ownerEmail: 'thuan@x',
});
const KT = node('kt', 't2', 'Kế toán E2E', { nodeType: 'room', status: 'pending', pendingApprovalId: 'a1', latestVersion: saved(4), versionCount: 4, draftCount: 4 });
const R1 = node('r1', 'sv', 'Tủ R1 E2E', { nodeType: 'cabinet' });
const PRES = node('p1', null, 'Họp BGĐ E2E', { kind: 'presentation', status: 'draft', latestVersion: saved(2), createdBy: 'other@x' });
const TREE = [ROOT, T1, T2, LT, SV, KT, R1, PRES];

function version(seq: number, extra: Partial<VersionItem> = {}): VersionItem {
  return {
    id: `v${seq}`,
    seq,
    summary: `thay đổi ${seq}`,
    label: null,
    savedBy: 'an@x',
    savedByName: 'An',
    savedAt: '2026-10-04T03:20:00Z',
    basedOnVersionId: null,
    restoredFromSeq: null,
    ...extra,
  };
}

const SV_VERSIONS = [15, 14, 13, 12, 11, 10, 9, 8, 7].map((seq) =>
  version(
    seq,
    seq === 10
      ? { label: 'Trước khi đổi ISP' }
      : seq === 15
        ? { summary: '1 Hình tự do · lưu đè lên bản của E2E Super Admin', brief: '1 Hình tự do', overwrote: 'E2E Super Admin' }
        : {},
  ),
);
const SV_PUBLISHED = { officialVersionId: 'v12', publishedVersionIds: ['v7', 'v8', 'v9', 'v10', 'v11', 'v12'] };

type Calls = [string, RequestInit | undefined][];

/** Tuyến đặc thù trước, `/api/v1/diagrams` (cây) cuối — khớp theo thứ tự khai. */
function routeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const all: Record<string, (init?: RequestInit) => Response> = {
    '/api/v1/diagrams/sv/versions': () => jsonResponse(200, SV_VERSIONS),
    '/api/v1/diagrams/sv/publications': () => jsonResponse(200, SV_PUBLISHED),
    ...routes,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = Object.keys(all).find((path) => url.includes(path));
    if (hit) return Promise.resolve(all[hit](init));
    // Phiên bản của bản vẽ khác: server đòi mã (mặc định của bài).
    if (/\/(versions|publications)$/.test(url)) return Promise.resolve(jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }));
    if (url.endsWith('/api/v1/diagrams')) return Promise.resolve(jsonResponse(200, TREE));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

let location = '';
function Where() {
  const loc = useLocation();
  location = `${loc.pathname}${loc.search}`;
  return null;
}

function renderScreen(path: string, me: Me = ME) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/diagrams" element={<DiagramTreeScreen me={me} />} />
            <Route path="/diagrams/:id" element={<p>Màn bản vẽ</p>} />
          </Routes>
          <Where />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const panel = () => screen.getByRole('complementary', { name: 'Bản vẽ đang chọn' });

beforeEach(() => narrow(false));
afterEach(() => vi.unstubAllGlobals());

describe('Bản đồ — gốc là băng, con là khu, cháu là ô', () => {
  it('băng gốc: loại, tên, "v8 · Thuận · 2 giờ trước · 6 Bản vẽ bên trong", trạng thái CHỮ; khu và ô đúng chỗ', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const banner = within(map).getByRole('button', { name: /^Tổng công ty Toàn công ty E2E/ });
    expect(banner).toHaveTextContent('Tổng công ty');
    expect(banner).toHaveTextContent('v8 · Thuận · 2 giờ trước · 6 Bản vẽ bên trong');
    expect(banner).toHaveTextContent('Chính thức v8');
    const t2Tiles = within(map).getByRole('list', { name: 'Bản vẽ trong "Tầng 2 E2E"' });
    const tiles = within(t2Tiles).getAllByRole('listitem');
    expect(tiles.map((li) => li.querySelector('.dmap-tile-name')?.textContent ?? li.textContent)).toEqual(['Phòng server E2E', 'Kế toán E2E', '+ Bản vẽ con vào Tầng 2 E2E']);
    // Trạng thái có chữ, không chỉ màu; meta ngắn "v12 · 3 Bản nháp".
    expect(tiles[0]).toHaveTextContent('Chính thức · có bản nháp');
    expect(tiles[0]).toHaveTextContent('v12 · 3 Bản nháp');
    expect(tiles[0]).toHaveAttribute('data-tone', 'warn');
    expect(tiles[1]).toHaveTextContent('Chờ duyệt');
    expect(tiles[1]).toHaveAttribute('data-tone', 'info');
    const lt = within(within(map).getByRole('list', { name: 'Bản vẽ trong "Tầng 1 E2E"' })).getAllByRole('listitem')[0];
    expect(lt).toHaveTextContent('Lệch kho (1)');
    expect(lt).toHaveAttribute('data-tone', 'danger');
    // Bản trình bày đứng ngoài bản đồ, thành dải chip.
    expect(screen.getByRole('heading', { name: 'Bản trình bày (1)' })).toBeInTheDocument();
    expect(within(map).getAllByRole('button', { name: 'Họp BGĐ E2E' })).toHaveLength(1);
  });

  it('ô có con → "▸ 1 Bản vẽ con": bấm thì bản đồ lấy ô đó làm gốc, có đường dẫn quay lại; ?root= trong URL', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Xem 1 bản vẽ con của "Phòng server E2E"' }));
    const map = screen.getByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(within(map).getByRole('button', { name: /^Phòng Phòng server E2E/ })).toHaveClass('dmap-banner');
    expect(within(map).getByRole('button', { name: /^Tủ R1 E2E/ })).toHaveClass('dmap-area-head');
    expect(location).toContain('root=sv');
    const crumbs = screen.getByRole('navigation', { name: 'Vị trí trên bản đồ' });
    expect(crumbs).toHaveTextContent('Tất cả bản vẽ');
    expect(crumbs).toHaveTextContent('Tầng 2 E2E');
    await user.click(within(crumbs).getByRole('link', { name: 'Tất cả bản vẽ' }));
    expect(within(screen.getByRole('region', { name: 'Bản đồ bản vẽ' })).getByRole('button', { name: /^Tổng công ty Toàn công ty E2E/ })).toHaveClass('dmap-banner');
    expect(location).not.toContain('root=');
  });

  it('kiểu "Danh sách": cây thụt lề phẳng, mở hết; chọn ở đây cũng mở panel', async () => {
    routeFetch({});
    renderScreen('/diagrams?view=list');
    const list = await screen.findByRole('list', { name: 'Cây bản vẽ' });
    const names = within(list)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Toàn công ty E2E', 'Tầng 1 E2E', 'Lễ tân E2E', 'Tầng 2 E2E', 'Phòng server E2E', 'Tủ R1 E2E', 'Kế toán E2E', 'Họp BGĐ E2E']);
    expect(screen.getByRole('radio', { name: 'Danh sách' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(within(list).getByRole('button', { name: 'Kế toán E2E' }));
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Kế toán E2E' })).toBeInTheDocument();
  });
});

/** UX-E07: hàng chờ duyệt bản vẽ nằm ở màn Sơ đồ mạng — nav "Sơ đồ mạng" mang badge, bấm là tới đây. */
describe('Khối "Bản vẽ chờ duyệt"', () => {
  const QUEUE = [
    { approvalId: 'p1', diagramId: 'kt', name: 'Kế toán E2E', requester: 'tv@pmh.com.vn', requesterName: 'Thành viên E2E', seq: 4, submittedAt: '2026-10-05T01:00:00Z' },
  ];

  it('Admin/SA thấy bản vẽ đang chờ mình duyệt, link mở thẳng bản vẽ', async () => {
    routeFetch({ '/api/v1/diagrams/reviews/pending': () => jsonResponse(200, QUEUE) });
    renderScreen('/diagrams');
    const block = await screen.findByRole('heading', { name: 'Bản vẽ chờ duyệt · 1' });
    const card = block.closest('section') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Mở Kế toán E2E' })).toHaveAttribute('href', '/diagrams/kt');
    expect(card).toHaveTextContent('Phiên bản #4');
    expect(card).toHaveTextContent('Thành viên E2E gửi lúc');
  });

  it('không có bản vẽ nào chờ thì không bày khối; Thành viên không hỏi hàng chờ', async () => {
    const fetchMock = routeFetch({ '/api/v1/diagrams/reviews/pending': () => jsonResponse(200, []) });
    const view = renderScreen('/diagrams');
    await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(screen.queryByRole('heading', { name: /Bản vẽ chờ duyệt/ })).toBeNull();
    view.unmount();
    fetchMock.mockClear();
    renderScreen('/diagrams', MEMBER);
    await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reviews/pending'))).toBe(false);
  });
});

describe('Dải "Cần làm" và ô tìm', () => {
  it('đếm nháp / chờ duyệt / lệch kho; bấm chip thì nút không khớp mờ đi (không biến mất), ?todo= trong URL', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    const strip = await screen.findByRole('region', { name: 'Cần làm' });
    const chips = within(strip).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['3 Bản nháp chưa phát hành', '1 Chờ duyệt', '1 Lệch kho']);
    const user = userEvent.setup();
    await user.click(chips[1]);
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    expect(location).toContain('todo=pending');
    expect(screen.getByText(/Đang lọc: 1 bản vẽ khớp\./)).toBeInTheDocument();
    const map = screen.getByRole('region', { name: 'Bản đồ bản vẽ' });
    const kt = within(map).getByRole('button', { name: /^Kế toán E2E/ }).closest('li');
    const sv = within(map).getByRole('button', { name: /^Phòng server E2E/ }).closest('li');
    expect(kt).not.toHaveAttribute('data-dim');
    expect(sv).toHaveAttribute('data-dim', 'true');
    await user.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(location).not.toContain('todo=');
  });

  it('ô có con mà con khớp: không mờ, nút đi sâu báo "Khớp: 1"', async () => {
    routeFetch({});
    renderScreen('/diagrams?todo=drift');
    await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const drill = screen.getByRole('button', { name: 'Xem 1 bản vẽ con của "Phòng server E2E"' });
    // Tủ R1 không lệch → không khớp; Phòng server cũng không → mờ.
    expect(drill).not.toHaveTextContent('Khớp');
    expect(drill.closest('li')).toHaveAttribute('data-dim', 'true');
  });

  it('gõ tên (không dấu) lọc bản vẽ; từ 2 ký tự còn hỏi server máy nằm ở bản vẽ nào', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/find': () => jsonResponse(200, [{ id: 'm1', code: 'SW-E2E-01', name: null, diagrams: [{ id: 'sv', name: 'Phòng server E2E' }] }]),
    });
    renderScreen('/diagrams');
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Tìm bản vẽ hoặc thiết bị' }), 'phong server');
    expect(location).toContain('q=phong');
    const map = screen.getByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(within(map).getByRole('button', { name: /^Kế toán E2E/ }).closest('li')).toHaveAttribute('data-dim', 'true');
    expect(within(map).getByRole('button', { name: /^Phòng server E2E/ }).closest('li')).not.toHaveAttribute('data-dim');
    const found = await screen.findByRole('link', { name: 'SW-E2E-01 → "Phòng server E2E"' });
    expect(found).toHaveAttribute('href', '/diagrams/sv?focus=m1');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/diagrams/find?q=phong+server'))).toBe(true);
  });

  // ST-07: lọc không ra bản vẽ nào thì cả bản đồ mờ kèm một dòng chữ nhạt — nói rõ và cho nút gỡ.
  it('tìm không khớp bản vẽ nào: khung rỗng nói từ đã gõ + nút "Xóa bộ lọc"; không bày bản đồ mờ', async () => {
    routeFetch({ '/api/v1/diagrams/find': () => jsonResponse(200, []) });
    renderScreen('/diagrams?q=zzzz');
    expect(await screen.findByText('Không có bản vẽ nào khớp "zzzz".')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bản đồ bản vẽ' })).toBeNull();
    expect(screen.queryByText(/Đang lọc: 0/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(location).not.toContain('q=');
    expect(await screen.findByRole('region', { name: 'Bản đồ bản vẽ' })).toBeInTheDocument();
  });
});

describe('Panel bản vẽ đang chọn', () => {
  it('chuyển nhanh giữa bản vẽ cùng khu (tablist, số phiên bản); tiêu đề + số đếm + người phụ trách; Mở / Sửa tiếp nháp', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    const tabs = within(aside).getByRole('tablist', { name: 'Bản vẽ trong "Tầng 2 E2E"' });
    const items = within(tabs).getAllByRole('tab');
    expect(items.map((tab) => tab.textContent)).toEqual(['Phòng server E2E 15', 'Kế toán E2E 4']);
    expect(items[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(aside).getByRole('heading', { level: 2, name: 'Phòng server E2E' })).toBeInTheDocument();
    expect(aside).toHaveTextContent('15 Phiên bản · 24 Thiết bị · 41 Dây · 2 Tủ mạng · Phụ trách: thuan@x');
    expect(within(aside).getByRole('navigation', { name: 'Đường dẫn bản vẽ' })).toHaveTextContent('Toàn công ty E2ETầng 2 E2EPhòng server E2E');
    const user = userEvent.setup();
    // Nháp của người khác: nút nói rõ đang động vào việc của ai (D-04).
    await user.click(within(aside).getByRole('button', { name: 'Sửa tiếp nháp #15 (của Thuận)' }));
    expect(location).toBe('/diagrams/sv?mode=edit');
  });

  it('đường dẫn trong panel bấm được: chọn bản vẽ cấp trên (D-06)', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    const trail = within(aside).getByRole('navigation', { name: 'Đường dẫn bản vẽ' });
    expect(within(trail).queryByRole('button', { name: 'Phòng server E2E' })).toBeNull();
    await userEvent.setup().click(within(trail).getByRole('button', { name: 'Tầng 2 E2E' }));
    expect(location).toBe('/diagrams?node=t2');
  });

  it('bản vẽ gốc đứng một mình: panel không chừa khối trống trên tên (D-06)', async () => {
    const LONE = node('lone', null, 'Một mình E2E');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(String(input).endsWith('/api/v1/diagrams') ? jsonResponse(200, [LONE]) : jsonResponse(404, { code: 'NOT_FOUND' })),
      ),
    );
    renderScreen('/diagrams?node=lone');
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    await within(aside).findByRole('heading', { level: 2, name: 'Một mình E2E' });
    expect(aside.querySelector('.dpanel-top')).toBeNull();
  });

  // PW-B23: "Chưa vẽ" đã là trạng thái — dòng "Chưa lưu lần nào" chỉ lặp lại; chưa vẽ thì việc
  // chính là Sửa, không phải mở xem một bản vẽ trống.
  it('bản vẽ chưa vẽ: không lặp "Chưa lưu lần nào"; Sửa là nút chính', async () => {
    const LONE = node('lone', null, 'Một mình E2E');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(String(input).endsWith('/api/v1/diagrams') ? jsonResponse(200, [LONE]) : jsonResponse(404, { code: 'NOT_FOUND' })),
      ),
    );
    renderScreen('/diagrams?node=lone');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(within(map).getByText('Chưa vẽ')).toBeInTheDocument();
    expect(screen.queryByText('Chưa lưu lần nào')).toBeNull();
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    expect(within(aside).getByRole('button', { name: 'Sửa' })).toHaveClass('primary');
    expect(within(aside).getByRole('button', { name: 'Mở xem' })).not.toHaveClass('primary');
  });

  it('bản vẽ đã có nội dung: Mở là nút chính, Sửa là nút thường', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=t1');
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    expect(await within(aside).findByRole('button', { name: 'Mở bản chính thức' })).toHaveClass('primary');
    expect(within(aside).getByRole('button', { name: 'Sửa' })).not.toHaveClass('primary');
  });

  it('bấm tab bản vẽ khác: panel đổi sang nó, ?node= đổi theo', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const aside = await screen.findByRole('complementary', { name: 'Bản vẽ đang chọn' });
    await userEvent.setup().click(within(aside).getByRole('tab', { name: 'Kế toán E2E 4' }));
    expect(within(aside).getByRole('heading', { level: 2, name: 'Kế toán E2E' })).toBeInTheDocument();
    expect(location).toContain('node=kt');
  });

  it('khu Nháp: #13–#15 mới trước, tick #14 → #15 theo; bỏ tick #15 → bỏ cả #14 (chỉ cắt đuôi)', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const boxes = within(drafts).getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['Chọn nháp #15', 'Chọn nháp #14', 'Chọn nháp #13']);
    const user = userEvent.setup();
    await user.click(within(drafts).getByRole('checkbox', { name: 'Chọn nháp #14' }));
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(drafts).toHaveTextContent('Đã chọn #14–#15');
    expect(within(drafts).getByRole('button', { name: 'Xóa 2 bản nháp' })).toBeEnabled();
    await user.click(within(drafts).getByRole('checkbox', { name: 'Chọn nháp #15' }));
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, false, false]);
    expect(within(drafts).getByRole('button', { name: 'Xóa 0 bản nháp' })).toBeDisabled();
  });

  it('Xóa từ #14: xem trước với fromSeq, hộp xác nhận nói giữ các lần lưu trước #14, gửi fromSeq + dải', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/sv/drafts/discard': () => jsonResponse(201, { count: 2, ranges: '#14–#15' }),
      '/api/v1/diagrams/sv/drafts': () => jsonResponse(200, { count: 2, ranges: '#14–#15', keepSeq: 12, keptDrafts: 0, blockedByApprovalId: null }),
    });
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const user = userEvent.setup();
    await user.click(within(drafts).getByRole('checkbox', { name: 'Chọn nháp #14' }));
    await user.click(within(drafts).getByRole('button', { name: 'Xóa 2 bản nháp' }));
    const confirm = await screen.findByRole('dialog', { name: 'Bỏ 2 bản nháp của "Phòng server E2E"?' });
    expect(confirm).toHaveTextContent('Xóa vĩnh viễn 2 lần lưu #14–#15, giữ bản chính thức v12, cùng các lần lưu trước #14.');
    await user.click(within(confirm).getByRole('button', { name: 'Bỏ bản nháp' }));
    expect(await screen.findByText('Đã bỏ 2 bản nháp (#14–#15) của "Phòng server E2E".')).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Calls;
    expect(calls.some(([url]) => String(url).endsWith('/api/v1/diagrams/sv/drafts?fromSeq=14'))).toBe(true);
    const discard = calls.find(([url]) => String(url).endsWith('/drafts/discard'));
    expect(JSON.parse(String(discard?.[1]?.body))).toEqual({ ranges: '#14–#15', fromSeq: 14 });
  });

  it('"Chỉ giữ bản này" ở #14 (Q-26 07/10): xem trước, hộp nói gộp dải nào thành bản số mấy, gửi đúng bản + dải đã thấy', async () => {
    const fetchMock = routeFetch({
      '/api/v1/diagrams/sv/drafts/collapse': (init) =>
        init?.method === 'POST'
          ? jsonResponse(201, { id: 'v13n', seq: 13, count: 3, ranges: '#13–#15' })
          : jsonResponse(200, { count: 3, ranges: '#13–#15', keepSeq: null, keptDrafts: 0, blockedByApprovalId: null, nextSeq: 13 }),
    });
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const user = userEvent.setup();
    await user.click(within(drafts).getByRole('button', { name: 'Chỉ giữ bản nháp #14' }));
    const confirm = await screen.findByRole('dialog', { name: 'Chỉ giữ bản nháp #14 của "Phòng server E2E"?' });
    expect(confirm).toHaveTextContent('Gộp 3 lần lưu #13–#15 thành MỘT bản #13 mang nội dung của #14.');
    await user.click(within(confirm).getByRole('button', { name: 'Chỉ giữ bản này' }));
    expect(await screen.findByText('Đã gộp 3 lần lưu thành bản #13 của "Phòng server E2E".')).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Calls;
    expect(calls.some(([url]) => String(url).endsWith('/api/v1/diagrams/sv/drafts/collapse?versionId=v14'))).toBe(true);
    const post = calls.find(([url, init]) => String(url).endsWith('/drafts/collapse') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ versionId: 'v14', ranges: '#13–#15' });
  });

  it('Bỏ nháp bị chặn vì yêu cầu chờ duyệt: báo rút trước, không hỏi xác nhận', async () => {
    routeFetch({
      '/api/v1/diagrams/sv/drafts': () => jsonResponse(200, { count: 3, ranges: '#13–#15', keepSeq: 12, keptDrafts: 0, blockedByApprovalId: 'a1' }),
    });
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const user = userEvent.setup();
    await user.click(within(drafts).getByRole('checkbox', { name: 'Chọn nháp #13' }));
    await user.click(within(drafts).getByRole('button', { name: 'Xóa 3 bản nháp' }));
    expect(await screen.findByText(/người gửi rút yêu cầu trước/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Bỏ \d+ bản nháp/ })).toBeNull();
  });

  it('SA: "Phát hành #15" → hỏi xác nhận → POST /publish', async () => {
    const fetchMock = routeFetch({ '/api/v1/diagrams/sv/publish': () => jsonResponse(201, { seq: 15, warnings: [] }) });
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const user = userEvent.setup();
    await user.click(within(drafts).getByRole('button', { name: 'Phát hành #15' }));
    const confirm = await screen.findByRole('dialog', { name: /Phát hành/ });
    await user.click(within(confirm).getByRole('button', { name: 'Phát hành' }));
    await waitFor(() => expect((fetchMock.mock.calls as unknown as Calls).some(([url, init]) => String(url).endsWith('/sv/publish') && init?.method === 'POST')).toBe(true));
  });

  it('Thành viên lưu nháp mới nhất: "Gửi duyệt #15" (không "Phát hành"); không tick bỏ nháp bản chính thức', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv', { ...MEMBER, email: 'Thuan@x' } as Me);
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    expect(within(drafts).getByRole('button', { name: 'Gửi duyệt #15' })).toBeInTheDocument();
    expect(within(drafts).queryByRole('button', { name: /^Phát hành/ })).toBeNull();
    expect(within(drafts).queryByRole('checkbox')).toBeNull();
    expect(panel()).toHaveTextContent('Sửa tiếp nháp #15');
    expect(panel()).not.toHaveTextContent('(của Thuận)');
  });

  it('Thành viên không thấy "Gửi duyệt" trên nháp người khác lưu (D-04) — server cũng chặn', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv', MEMBER);
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    expect(within(drafts).queryByRole('button', { name: /Gửi duyệt/ })).toBeNull();
    expect(within(panel()).getByRole('button', { name: 'Sửa tiếp nháp #15 (của Thuận)' })).toBeInTheDocument();
  });

  it('khu Đã phát hành: mới trước, bản đang dùng có nhãn; Xem / So sánh / ⋮; "Xem thêm 2 phiên bản cũ"', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const published = await screen.findByRole('region', { name: 'Đã phát hành · 6' });
    expect(published).toHaveTextContent('Giữ mãi, không xóa');
    const rows = within(published).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('v12');
    expect(rows[0]).toHaveTextContent('Đang dùng');
    expect(rows[2]).toHaveTextContent('v10 · "Trước khi đổi ISP"');
    const user = userEvent.setup();
    await user.click(within(published).getByRole('button', { name: 'Xem thêm 2 phiên bản cũ' }));
    expect(within(published).getAllByRole('listitem')).toHaveLength(6);
    await user.click(within(rows[1]).getByRole('button', { name: 'Thêm thao tác với v11' }));
    const names = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    expect(names).toEqual(['Đặt tên', 'Khôi phục', 'Khôi phục làm chính thức']);
    await user.keyboard('{Escape}');
    await user.click(within(rows[1]).getByRole('button', { name: 'So sánh v11 với bản mới nhất' }));
    expect(location).toBe('/diagrams/sv?version=v15&compare=v11');
  });

  it('hết ân hạn sơ đồ: KHÔNG tự bật hộp hỏi mã; nút "Nhập mã để xem lịch sử" hỏi mã rồi hiện danh sách', async () => {
    let unlocked = false;
    routeFetch({
      '/api/v1/auth/step-up': () => {
        unlocked = true;
        return jsonResponse(200, { status: 'stepped-up', scope: 'diagram', graceMinutes: 10 });
      },
      '/api/v1/diagrams/sv/versions': () => (unlocked ? jsonResponse(200, SV_VERSIONS) : jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })),
      '/api/v1/diagrams/sv/publications': () => (unlocked ? jsonResponse(200, SV_PUBLISHED) : jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 })),
    });
    renderScreen('/diagrams?node=sv');
    const unlock = await screen.findByRole('button', { name: 'Nhập mã để xem lịch sử' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Tên, trạng thái, số đếm vẫn hiện — đó là thông tin của cây.
    expect(panel()).toHaveTextContent('15 Phiên bản');
    const user = userEvent.setup();
    await user.click(unlock);
    const step = await screen.findByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' });
    await user.type(within(step).getAllByRole('textbox')[0], '123456');
    expect(await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' })).toBeInTheDocument();
  });

  it('menu ⋮ của bản vẽ: Thành viên thêm con (+ Xóa hẳn bản mình tạo chưa phát hành); SA thêm đổi tên / lưu trữ; không còn Trình chiếu (Q-32)', async () => {
    const menuNames = async () =>
      (await screen.findAllByRole('menuitem')).map((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
        return copy.textContent;
      });
    routeFetch({});
    const view = renderScreen('/diagrams?node=r1', MEMBER);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Tủ R1 E2E' }));
    expect(await menuNames()).toEqual(['Thêm bản vẽ con', 'Xóa hẳn']);
    view.unmount();
    renderScreen('/diagrams?node=lt', MEMBER);
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Lễ tân E2E' }));
    expect(await menuNames()).toEqual(['Thêm bản vẽ con']);
    await user.keyboard('{Escape}');
    renderScreen('/diagrams?node=r1', ME);
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Tủ R1 E2E' }));
    expect(await menuNames()).toEqual(['Thêm bản vẽ con', 'Đổi tên / chuyển chỗ', 'Lưu trữ', 'Xóa hẳn']);
  });

  it('Xóa hẳn: gõ đúng tên mới bật nút; gửi tên lên server', async () => {
    const fetchMock = routeFetch({ '/api/v1/diagrams/r1/purge': () => jsonResponse(201, { versions: 0 }) });
    renderScreen('/diagrams?node=r1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Tủ R1 E2E' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa hẳn' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xóa hẳn "Tủ R1 E2E"?' });
    const go = within(confirm).getByRole('button', { name: 'Xóa hẳn' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText('Gõ lại tên bản vẽ để xác nhận'), 'Tủ R1 E2E');
    await user.click(go);
    expect(await screen.findByText('Đã xóa hẳn "Tủ R1 E2E".')).toBeInTheDocument();
    const call = (fetchMock.mock.calls as unknown as Calls).find(([url]) => String(url).includes('/purge'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ name: 'Tủ R1 E2E' });
  });

  it('lần lưu mới nhất là nháp thì ghi "Nháp #n", không ghi "vn" như bản chính thức', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const t2 = within(map).getByRole('button', { name: /^Tầng 2 E2E/ });
    expect(t2).toHaveTextContent('Nháp #10 · Thuận');
    expect(t2).not.toHaveTextContent('v10');
    const kt = within(within(map).getByRole('list', { name: 'Bản vẽ trong "Tầng 2 E2E"' })).getAllByRole('listitem')[1];
    expect(kt).toHaveTextContent('4 Bản nháp');
  });

  // PW-B22: một từ "bản vẽ con" cho mọi lối thêm; không còn ô "+ Khu mới" kề ô thêm của khu cuối.
  it('ô thêm trong khu nói rõ đích; gốc đã có khu không còn ô "+ Khu mới"', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(within(map).getByRole('button', { name: 'Thêm bản vẽ con vào "Tầng 1 E2E"' })).toHaveTextContent('+ Bản vẽ con vào Tầng 1 E2E');
    expect(within(map).queryByRole('button', { name: 'Thêm bản vẽ con vào "Toàn công ty E2E"' })).toBeNull();
    expect(within(map).queryByText(/Khu mới/)).toBeNull();
  });

  it('"+ Bản vẽ con" trên khu mở hộp thêm con đúng bản cha', async () => {
    routeFetch({});
    renderScreen('/diagrams');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thêm bản vẽ con vào "Tầng 1 E2E"' }));
    expect(await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Tầng 1 E2E"' })).toBeInTheDocument();
  });
});

describe('390px', () => {
  it('bản đồ một cột, không có panel cạnh; bấm ô mở panel thành hộp; không Sửa / Phát hành', async () => {
    narrow(true);
    routeFetch({});
    renderScreen('/diagrams');
    await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(screen.queryByRole('complementary', { name: 'Bản vẽ đang chọn' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Phòng server E2E/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Bản vẽ đang chọn' });
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Phòng server E2E' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Mở bản chính thức' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /^Sửa/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /^Phát hành/ })).toBeNull();
  });
});

describe('Panel gọn (Q-23 05/10)', () => {
  it('dòng nháp: tiêu đề "#15 · tóm tắt ngắn", người lưu / giờ dòng hai, "lưu đè" thành nhãn nhỏ', async () => {
    routeFetch({});
    renderScreen('/diagrams?node=sv');
    const drafts = await screen.findByRole('region', { name: 'Nháp chưa phát hành · 3' });
    const row = within(drafts).getAllByRole('listitem')[0];
    expect(row.querySelector('strong')).toHaveTextContent(/^#15 · 1 Hình tự do$/);
    expect(row).toHaveTextContent('An');
    expect(row.querySelector('.dpanel-tag')).toHaveTextContent('Lưu đè bản của E2E Super Admin');
  });

  it('bản vẽ gốc chưa có con: băng một dòng kèm "+ Bản vẽ con", không có khối gợi ý lớn', async () => {
    routeFetch({ '/api/v1/diagrams/archived': () => jsonResponse(200, []) });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/diagrams')) return Promise.resolve(jsonResponse(200, [...TREE, node('lone', null, 'Chi nhánh lẻ E2E')]));
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderScreen('/diagrams');
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const lone = within(map).getByRole('button', { name: /^Tổng công ty Chi nhánh lẻ E2E/ }).closest('section');
    expect(lone).toHaveClass('dmap-root-compact');
    expect(within(lone as HTMLElement).getByRole('button', { name: 'Thêm bản vẽ con vào "Chi nhánh lẻ E2E"' })).toHaveTextContent('+ Bản vẽ con vào Chi nhánh lẻ E2E');
    expect(within(lone as HTMLElement).queryByText(/Chưa có bản vẽ con/)).toBeNull();
    expect((lone as HTMLElement).querySelector('.dmap-areas')).toBeNull();
  });
});

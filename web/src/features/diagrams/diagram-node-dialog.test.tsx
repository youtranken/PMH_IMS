import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramNode, VersionItem } from './diagram-api';
import { DiagramNodeDialog } from './diagram-node-dialog';

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const PARENT: DiagramNode = {
  id: 'p1',
  parentId: null,
  name: 'Cha E2E',
  nodeType: 'site',
  siteId: null,
  cabinetId: null,
  ownerEmail: null,
  kind: 'official',
  archivedAt: null,
  status: 'official_draft',
  officialSeq: 3,
  officialVersionId: 'v3',
  latestVersion: { id: 'v5', seq: 5, savedAt: '2026-10-04T03:00:00Z', savedBy: 'a@x' },
};

const version = (seq: number, extra: Partial<VersionItem> = {}): VersionItem => ({
  id: `v${seq}`, seq, summary: `tóm tắt ${seq}`, label: null, savedBy: 'a@x', savedByName: 'An', savedAt: '2026-10-04T03:00:00Z', basedOnVersionId: null, restoredFromSeq: null, ...extra,
});

function mockFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/p1/versions')) return Promise.resolve(jsonResponse(200, [5, 4, 3, 2, 1].map((s) => version(s, s === 2 ? { label: 'Trước đổi ISP' } : {}))));
    if (url.endsWith('/p1/publications')) return Promise.resolve(jsonResponse(200, { officialVersionId: 'v3', publishedVersionIds: ['v1', 'v3'] }));
    if (url.endsWith('/p1/copied-children') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { versionId?: string };
      return Promise.resolve(jsonResponse(201, { ...PARENT, id: 'c1', parentId: 'p1', name: 'Con E2E', copiedFromSeq: Number(body.versionId?.slice(1)) }));
    }
    return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Thêm bản vẽ con — chép từ phiên bản chọn (Q-23 05/10, 06/10 chiều)', () => {
  it('mặc định TRANG TRẮNG; chọn chép thì mặc định bản chính thức #3; "Chọn phiên bản khác…" thêm bản đã phát hành / đã đặt tên; gửi versionId', async () => {
    const fetchMock = mockFetch();
    const calls: string[] = [];
    const run = <T,>(action: () => Promise<T>, purpose: string): Promise<T> => {
      calls.push(purpose);
      return action();
    };
    renderWithI18n(
      <ToastProvider>
        <DiagramNodeDialog me={ME} nodes={[PARENT]} parent={PARENT} run={run} onClose={() => undefined} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Cha E2E"' });
    // Không gì tự chép mà người dùng không bấm (Q-23).
    expect(within(dialog).getByRole('radio', { name: 'Trang trắng' })).toBeChecked();
    expect(within(dialog).queryByRole('button', { name: 'Phiên bản của bản cha' })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Chép nội dung bản vẽ cha' }));
    expect(within(dialog).getByText(/Chép MỘT lần/)).toBeInTheDocument();
    const picker = within(dialog).getByRole('button', { name: 'Phiên bản của bản cha' });
    expect(picker).toHaveTextContent('#3 · bản chính thức');
    await user.click(picker);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#3 · bản chính thức', '#5 · bản mới nhất']);
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Chọn phiên bản khác…' }));
    expect(calls).toEqual(['Nhập mã 6 số để chép nội dung "Cha E2E" sang bản vẽ con.']);
    await user.click(within(dialog).getByRole('button', { name: 'Phiên bản của bản cha' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.map((o) => o.split(' · ').slice(0, 2).join(' · '))).toEqual(['#3 · bản chính thức', '#5 · bản mới nhất', '#2 · Trước đổi ISP', '#1 · từng phát hành']);
    await user.click(screen.getByRole('option', { name: /^#2 · Trước đổi ISP/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Tên bản vẽ/ }), 'Con E2E');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/copied-children') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: 'Con E2E', versionId: 'v2' });
    expect(await screen.findByText('Đã tạo bản vẽ "Con E2E" — chép từ "Cha E2E" phiên bản #2.')).toBeInTheDocument();
  });
});

describe('Form bản vẽ: Site theo bản cha, ô Tủ chỉ ở cấp tủ (D-03)', () => {
  const LISTS = {
    sites: [{ id: 's1', code: 'TOWER', name: 'Tower', active: true }],
    cabinets: [{ id: 'k1', code: 'TU-TOWER-01', siteId: 's1', active: true }],
  };
  function mockLists() {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/v1/diagrams') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { ...PARENT, id: 'n1', name: 'Tủ E2E', ...JSON.parse(String(init.body)) }));
      }
      return Promise.resolve(jsonResponse(200, LISTS));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('bản vẽ con điền sẵn Site của bản cha; "Cấp bản vẽ" thay "Loại nút"; ô Tủ chỉ hiện khi cấp là tủ, kèm lời giải thích', async () => {
    const fetchMock = mockLists();
    const parent = { ...PARENT, siteId: 's1', latestVersion: null };
    renderWithI18n(
      <ToastProvider>
        <DiagramNodeDialog me={ME} nodes={[parent]} parent={parent} onClose={() => undefined} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Cha E2E"' });
    expect(await within(dialog).findByRole('button', { name: 'Site' })).toHaveTextContent('TOWER — Tower');
    expect(within(dialog).queryByText('Loại nút')).toBeNull();
    const level = within(dialog).getByRole('button', { name: 'Cấp bản vẽ' });
    expect(within(dialog).queryByRole('button', { name: /^Tủ/ })).toBeNull();
    await user.click(level);
    await user.click(screen.getByRole('option', { name: 'Tủ mạng' }));
    expect(within(dialog).getByRole('button', { name: /^Tủ/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/Gắn tủ để dựng mặt tủ từ kho/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Tủ/ }));
    await user.click(screen.getByRole('option', { name: 'TU-TOWER-01' }));
    // Đổi về cấp khác thì tủ đã chọn bỏ đi — không gửi tủ cho bản vẽ không phải cấp tủ.
    await user.click(within(dialog).getByRole('button', { name: 'Cấp bản vẽ' }));
    await user.click(screen.getByRole('option', { name: 'Phòng' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Tên bản vẽ/ }), 'Phòng E2E');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/v1/diagrams') && init?.method === 'POST');
    const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Phòng E2E', nodeType: 'room', siteId: 's1', parentId: 'p1' });
    expect(body).not.toHaveProperty('cabinetId');
  });

  it('"Cấp bản vẽ" tự giải thích: chỉ Tủ mạng đổi cách hoạt động (Q-23 06/10 chiều)', async () => {
    mockLists();
    renderWithI18n(
      <ToastProvider>
        <DiagramNodeDialog me={ME} nodes={[]} onClose={() => undefined} />
      </ToastProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Thêm bản vẽ' });
    expect(within(dialog).getByText(/các cấp khác chỉ là nhãn trên bản đồ/)).toBeInTheDocument();
    // Gốc cây cấp thường chỉ có một cách bắt đầu: không hỏi.
    expect(within(dialog).queryByRole('radiogroup', { name: 'Bắt đầu từ' })).toBeNull();
  });
});

describe('Dựng từ kho — bản vẽ cấp tủ (Q-23 06/10 chiều)', () => {
  it('cấp tủ chưa chọn tủ: "Dựng từ kho" tắt kèm lý do; chọn tủ thì tự bật làm mặc định; Lưu gọi from-stock qua hỏi mã', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/v1/diagrams/from-stock') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { ...PARENT, id: 'r1', parentId: 'p1', nodeType: 'cabinet', name: 'Tủ E2E' }));
      }
      return Promise.resolve(jsonResponse(200, { sites: [{ id: 's1', code: 'TOWER', name: 'Tower', active: true }], cabinets: [{ id: 'k1', code: 'TU-TOWER-01', siteId: 's1', active: true }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const calls: string[] = [];
    const run = <T,>(action: () => Promise<T>, purpose: string): Promise<T> => {
      calls.push(purpose);
      return action();
    };
    const parent = { ...PARENT, siteId: 's1' };
    renderWithI18n(
      <ToastProvider>
        <DiagramNodeDialog me={ME} nodes={[parent]} parent={parent} run={run} onClose={() => undefined} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm bản vẽ con vào "Cha E2E"' });
    expect(within(dialog).queryByRole('radio', { name: 'Dựng từ kho' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cấp bản vẽ' }));
    await user.click(screen.getByRole('option', { name: 'Tủ mạng' }));
    const stock = within(dialog).getByRole('radio', { name: 'Dựng từ kho' });
    expect(stock).toBeDisabled();
    expect(within(dialog).getByText('Chọn tủ trước.')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Trang trắng' })).toBeChecked();
    await user.click(await within(dialog).findByRole('button', { name: /^Tủ/ }));
    await user.click(screen.getByRole('option', { name: 'TU-TOWER-01' }));
    expect(within(dialog).getByRole('radio', { name: 'Dựng từ kho' })).toBeChecked();
    await user.type(within(dialog).getByRole('textbox', { name: /Tên bản vẽ/ }), 'Tủ E2E');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/from-stock') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: 'Tủ E2E', nodeType: 'cabinet', cabinetId: 'k1', siteId: 's1', parentId: 'p1' });
    expect(calls).toEqual(['Nhập mã 6 số để dựng mặt tủ từ kho cho bản vẽ "Tủ E2E".']);
    expect(await screen.findByText('Đã tạo bản vẽ "Tủ E2E" — mặt tủ dựng từ kho, đang là bản nháp #1.')).toBeInTheDocument();
  });
});

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

describe('Thêm bản vẽ con — nhân bản từ phiên bản chọn (Q-23 05/10)', () => {
  it('mặc định bản chính thức #3; chọn được bản mới nhất #5; "Chọn phiên bản khác…" thêm bản đã phát hành / đã đặt tên; gửi versionId', async () => {
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
    expect(within(dialog).getByRole('radio', { name: 'Nhân bản từ bản cha' })).toBeChecked();
    const picker = within(dialog).getByRole('button', { name: 'Phiên bản của bản cha' });
    expect(picker).toHaveTextContent('#3 · bản chính thức');
    await user.click(picker);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['#3 · bản chính thức', '#5 · bản mới nhất']);
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Chọn phiên bản khác…' }));
    expect(calls).toEqual(['Nhập mã 6 số để nhân bản nội dung "Cha E2E" sang bản vẽ con.']);
    await user.click(within(dialog).getByRole('button', { name: 'Phiên bản của bản cha' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.map((o) => o.split(' · ').slice(0, 2).join(' · '))).toEqual(['#3 · bản chính thức', '#5 · bản mới nhất', '#2 · Trước đổi ISP', '#1 · từng phát hành']);
    await user.click(screen.getByRole('option', { name: /^#2 · Trước đổi ISP/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /Tên bản vẽ/ }), 'Con E2E');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/copied-children') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: 'Con E2E', versionId: 'v2' });
    expect(await screen.findByText('Đã tạo bản vẽ "Con E2E" — nhân bản từ "Cha E2E" phiên bản #2.')).toBeInTheDocument();
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
    await user.click(screen.getByRole('option', { name: 'Tủ rack' }));
    expect(within(dialog).getByRole('button', { name: /^Tủ/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/dựng mặt tủ từ kho/)).toBeInTheDocument();
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
});

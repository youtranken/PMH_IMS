import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
import { DiagramTreeScreen } from './diagram-tree-screen';

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const MEMBER = { ...SA, email: 'mem@e2e.local', role: 'member' } as Me;

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

const ROOT = node('d1', null, 'Toàn công ty E2E');
const OLD_FLOOR = node('f9', 'd1', 'Tầng cũ E2E', { archivedAt: '2026-10-01T03:00:00Z', archivedBy: 'an@x', archivedByName: 'An' });
const MY_PRES = node('p9', null, 'Trình bày cũ E2E', { kind: 'presentation', archivedAt: '2026-10-02T03:00:00Z', archivedBy: 'mem@e2e.local', createdBy: 'mem@e2e.local' });

let location = '';
function Where() {
  const loc = useLocation();
  location = `${loc.pathname}${loc.search}`;
  return null;
}

function mockFetch(archived: DiagramNode[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/diagrams/archived')) return Promise.resolve(jsonResponse(200, archived));
    if (url.endsWith('/unarchive') && init?.method === 'POST') return Promise.resolve(jsonResponse(200, { ...OLD_FLOOR, archivedAt: null }));
    if (url.endsWith('/erase') && init?.method === 'POST') return Promise.resolve(jsonResponse(201, { versions: 3 }));
    if (url.endsWith('/api/v1/diagrams')) return Promise.resolve(jsonResponse(200, [ROOT]));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen(path: string, me: Me = SA) {
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

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Khu "Đã lưu trữ" của /diagrams (Q-23, 05/10)', () => {
  it('nút "Đã lưu trữ (2)" bật khu liệt kê: tên, nằm dưới bản nào, ai cất; ?archived=1 trong URL; ở cả kiểu Danh sách', async () => {
    mockFetch([OLD_FLOOR, MY_PRES]);
    renderScreen('/diagrams');
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: 'Đã lưu trữ (2)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(location).toContain('archived=1');
    const section = screen.getByRole('region', { name: 'Bản vẽ đã lưu trữ (2)' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Tầng cũ E2E');
    expect(rows[0]).toHaveTextContent('Trong "Toàn công ty E2E"');
    expect(rows[0]).toHaveTextContent('· An');
    expect(rows[1]).toHaveTextContent('Bản trình bày');
    await user.click(screen.getByRole('radio', { name: 'Danh sách' }));
    expect(screen.getByRole('region', { name: 'Bản vẽ đã lưu trữ (2)' })).toBeInTheDocument();
  });

  it('"Mở xem" sang màn bản vẽ (chỉ xem); SA "Bỏ lưu trữ" hỏi lại rồi gọi API', async () => {
    const fetchMock = mockFetch([OLD_FLOOR]);
    renderScreen('/diagrams?archived=1');
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Bản vẽ đã lưu trữ (1)' });
    await user.click(within(section).getByRole('button', { name: 'Bỏ lưu trữ "Tầng cũ E2E"' }));
    const confirm = await screen.findByRole('dialog', { name: 'Bỏ lưu trữ "Tầng cũ E2E"?' });
    await user.click(within(confirm).getByRole('button', { name: 'Bỏ lưu trữ' }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/diagrams/f9/unarchive') && init?.method === 'POST')).toBe(true);
    expect(await screen.findByText('Đã bỏ lưu trữ "Tầng cũ E2E" — bản vẽ trở lại bản đồ.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: /Bản vẽ đã lưu trữ/ })).getByRole('link', { name: 'Mở xem "Tầng cũ E2E"' }));
    expect(location).toBe('/diagrams/f9');
  });

  it('Thành viên: bản chính thức không có "Bỏ lưu trữ", bản trình bày của mình thì có', async () => {
    mockFetch([OLD_FLOOR, MY_PRES]);
    renderScreen('/diagrams?archived=1', MEMBER);
    const section = await screen.findByRole('region', { name: 'Bản vẽ đã lưu trữ (2)' });
    expect(within(section).queryByRole('button', { name: 'Bỏ lưu trữ "Tầng cũ E2E"' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Bỏ lưu trữ "Trình bày cũ E2E"' })).toBeInTheDocument();
  });

  it('SA "Xóa vĩnh viễn": hộp xác nhận nói rõ mất cả bản chính thức, bắt gõ đúng tên; gõ đúng mới gọi API với tên', async () => {
    const fetchMock = mockFetch([OLD_FLOOR]);
    renderScreen('/diagrams?archived=1');
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Bản vẽ đã lưu trữ (1)' });
    await user.click(within(section).getByRole('button', { name: 'Xóa vĩnh viễn "Tầng cũ E2E"' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xóa vĩnh viễn "Tầng cũ E2E"?' });
    expect(confirm).toHaveTextContent('kể cả bản chính thức');
    const go = within(confirm).getByRole('button', { name: 'Xóa vĩnh viễn' });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText('Gõ lại tên bản vẽ để xác nhận'), 'Tầng cũ E2E');
    await user.click(go);
    expect(await screen.findByText('Đã xóa vĩnh viễn "Tầng cũ E2E".')).toBeInTheDocument();
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).find(([url]) => String(url).endsWith('/api/v1/diagrams/f9/erase'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ name: 'Tầng cũ E2E' });
  });

  it('Thành viên không thấy "Xóa vĩnh viễn", kể cả bản trình bày của mình', async () => {
    mockFetch([OLD_FLOOR, MY_PRES]);
    renderScreen('/diagrams?archived=1', MEMBER);
    const section = await screen.findByRole('region', { name: 'Bản vẽ đã lưu trữ (2)' });
    expect(within(section).queryByRole('button', { name: /Xóa vĩnh viễn/ })).toBeNull();
  });

  it('không có bản nào lưu trữ → không có nút', async () => {
    mockFetch([]);
    renderScreen('/diagrams');
    await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    expect(screen.queryByRole('button', { name: /Đã lưu trữ/ })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { draftKeyOf, loadDraft, memoryDraftBackend, saveDraft } from '@/lib/draft-store';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';

/**
 * Bản vẽ dở (Q-23 06/10): cất mã hoá ở trình duyệt, mở lại tab Sửa thì mời "Khôi phục / Bỏ";
 * khôi phục nạp vào trình vẽ thành thay đổi CHƯA LƯU, không bao giờ tự ghi server.
 */

const store = vi.hoisted(() => ({ backend: null as unknown as ReturnType<typeof memoryDraftBackend> }));
vi.mock('@/lib/draft-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/draft-store')>();
  return { ...actual, browserDraftBackend: () => store.backend };
});

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const ROOT: DiagramNode = {
  id: 'd1',
  parentId: null,
  name: 'Phòng E2E',
  nodeType: 'room',
  siteId: null,
  cabinetId: null,
  ownerEmail: null,
  kind: 'official',
  archivedAt: null,
  status: 'draft',
  latestVersion: null,
};
const VERSION = { id: 'v2', seq: 2, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-06T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const FILE = '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const DRAFT = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="t1" value="vẽ dở E2E" vertex="1" parent="1"><mxGeometry width="80" height="30" as="geometry"/></mxCell></root></mxGraphModel>';

async function openEditor(content: Record<string, unknown> = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/editor-settings')) return Promise.resolve(jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60, draftKeepHours: 24 }));
    if (url.includes('/d1/content')) return Promise.resolve(jsonResponse(200, { diagram: ROOT, version: { ...VERSION, xml: FILE, svg: '<svg/>' }, draftKey: KEY, ...content }));
    if (url.includes('/d1/presence')) return Promise.resolve(jsonResponse(200, { others: [] }));
    if (url.includes('/diagrams/d1')) return Promise.resolve(jsonResponse(200, ROOT));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
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
  const messages = () => posted.mock.calls.map(([data]) => JSON.parse(String(data)) as Record<string, unknown>);
  return { fetchMock, fromDrawio, messages };
}

beforeEach(() => {
  store.backend = memoryDraftBackend();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe('Bản vẽ dở — cất và khôi phục (Q-23 06/10)', () => {
  it('đang vẽ thì cất (đã mã hoá) sau khi ngừng tay; đóng tab thì ghi ngay', async () => {
    const { fromDrawio } = await openEditor();
    fromDrawio({ event: 'autosave', xml: DRAFT });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await vi.waitFor(() => expect(store.backend.rows.has(draftKeyOf('u1', 'd1'))).toBe(true));
    const back = await loadDraft(store.backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', rawKey: KEY, keepHours: 24 });
    expect(back.value).toMatchObject({ text: DRAFT, basedOn: 'v2' });
  });

  it('mở lại còn bản dở → "Có bản đang vẽ dở lúc …" — Khôi phục nạp vào trình vẽ thành chưa lưu, KHÔNG gọi lưu', async () => {
    await saveDraft(store.backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', basedOn: 'v1', text: DRAFT, rawKey: KEY, now: Date.UTC(2026, 9, 6, 2, 15) });
    const { fetchMock, messages } = await openEditor();
    expect(await screen.findByText(/Có bản đang vẽ dở lúc 06\/10\/2026 09:15 chưa lưu\./)).toBeInTheDocument();
    // Bản dở vẽ trên v1, bản vẽ nay đã có v2: nói trước là lưu sẽ ghi "lưu đè".
    expect(screen.getByText(/đã có phiên bản mới hơn/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }));
    const loads = messages().filter((m) => m.action === 'load');
    expect(loads.at(-1)).toMatchObject({ xml: DRAFT, autosave: 1 });
    expect(await screen.findByText('Đã nạp bản đang vẽ dở — chưa lưu, bấm Lưu để giữ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls.some(([url, init]) => String(url).includes('/versions') && init?.method === 'POST')).toBe(false);
  });

  it('Bỏ → xoá bản dở, không nạp gì', async () => {
    await saveDraft(store.backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', basedOn: 'v2', text: DRAFT, rawKey: KEY });
    const { messages } = await openEditor();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bỏ' }));
    expect(store.backend.rows.size).toBe(0);
    expect(messages().filter((m) => m.action === 'load')).toHaveLength(1);
    expect(screen.queryByText(/Có bản đang vẽ dở/)).toBeNull();
  });

  it('bản dở của người khác, quá hạn, hay khoá đã đổi → không mời gì', async () => {
    await saveDraft(store.backend, { id: draftKeyOf('u1', 'd1'), owner: 'u1', basedOn: 'v2', text: DRAFT, rawKey: btoa('x'.repeat(32)) });
    await openEditor();
    await vi.waitFor(() => expect(store.backend.rows.size).toBe(0));
    expect(screen.queryByText(/Có bản đang vẽ dở/)).toBeNull();
  });

  it('nội dung không kèm khoá (server cũ / tab Xem) → không cất gì', async () => {
    const { fromDrawio } = await openEditor({ draftKey: undefined });
    fromDrawio({ event: 'autosave', xml: DRAFT });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.backend.rows.size).toBe(0);
  });
});

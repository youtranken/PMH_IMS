import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { FailedMailScreen } from './failed-mail-screen';

/**
 * Thư gửi lỗi (Q-25): thư hết lượt gửi tự động trước nay nằm im trong outbox. SA thấy loại thư,
 * số lần thử, lỗi cuối (API đã che địa chỉ) và "Gửi lại" từng thư.
 */

const SA = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'tok' } as unknown as Me;

const ITEM = {
  id: '11111111-1111-4111-8111-111111111111',
  topic: 'approval.requested',
  createdAt: '2026-10-05T01:00:00Z',
  failCount: 5,
  lastError: '550 <a***@pmh.com.vn> unknown',
  lastFailedAt: '2026-10-05T02:00:00Z',
};

function mockFetch(items: unknown[]) {
  let list = items;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/api/v1/admin/outbox/failed/${ITEM.id}/requeue`) && init?.method === 'POST') {
      list = [];
      return Promise.resolve(jsonResponse(201, { id: ITEM.id }));
    }
    if (url.endsWith('/api/v1/admin/outbox/failed')) return Promise.resolve(jsonResponse(200, { total: list.length, items: list }));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen() {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <FailedMailScreen me={SA} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Màn Thư gửi lỗi (SA)', () => {
  it('liệt kê thư chưa gửi được: loại thư bằng chữ, số lần thử, lỗi cuối; "Gửi lại" gọi API kèm CSRF rồi thư rời danh sách', async () => {
    const fetchMock = mockFetch([ITEM]);
    renderScreen();
    expect(await screen.findByRole('heading', { level: 1, name: 'Thư gửi lỗi' })).toBeInTheDocument();
    const row = (await screen.findByText('Thư xin duyệt')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('550 <a***@pmh.com.vn> unknown');

    await userEvent.setup().click(within(row).getByRole('button', { name: 'Gửi lại thư xin duyệt' }));
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).find(([url, init]) => url.endsWith('/requeue') && init?.method === 'POST');
    expect(new Headers(post?.[1]?.headers).get('x-csrf-token')).toBe('tok');
    expect(await screen.findByText('Đã đưa thư vào hàng gửi lại.')).toBeInTheDocument();
    expect(await screen.findByText('Không có thư nào gửi lỗi.')).toBeInTheDocument();
  });

  it('loại thư lạ (topic chưa có tên): hiện nguyên mã, không để trống', async () => {
    mockFetch([{ ...ITEM, topic: 'something.new' }]);
    renderScreen();
    expect(await screen.findByText('something.new')).toBeInTheDocument();
  });
});

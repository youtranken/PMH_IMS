import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { ApprovalsScreen } from './approvals-screen';

function row(id: string, requester: string) {
  return {
    id,
    kind: 'break_glass',
    state: 'pending',
    requester,
    subjectType: 'device',
    subjectId: `${id}-0000-4000-8000-000000000001`,
    reason: `Lý do của ${requester}`,
    payload: { hours: 4 },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    expiresAt: null,
    createdAt: '2026-09-20T01:30:00.000Z',
    active: false,
  };
}

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

function renderAt(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(jsonResponse(200, [row('a1', 'an@pmh.com.vn'), row('b2', 'binh@pmh.com.vn')])),
    ),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ApprovalsScreen me={ME} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * DOM-06 — nút trong thư duyệt mở `/approvals?id=<yêu cầu>`. Yêu cầu đó phải lên đầu và được
 * đánh dấu, để người duyệt trên điện thoại không phải dò trong cả hàng chờ.
 */
describe('Màn Duyệt yêu cầu mở từ thư', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('?id= đưa đúng yêu cầu lên đầu và đánh dấu nó', async () => {
    renderAt('/approvals?id=b2');
    const current = await screen.findByRole('region', { current: true });
    expect(current).toHaveTextContent('binh@pmh.com.vn');
    const cards = screen.getAllByRole('region');
    expect(cards[0]).toBe(current);
  });

  it('?id= không còn trong hàng chờ → nói rõ, vẫn hiện hàng chờ', async () => {
    renderAt('/approvals?id=zz');
    expect(await screen.findByText(/không còn chờ duyệt/)).toBeInTheDocument();
    expect(screen.getByText('an@pmh.com.vn')).toBeInTheDocument();
  });

  it('không có ?id= thì giữ thứ tự của máy chủ, không đánh dấu gì', async () => {
    renderAt('/approvals');
    await screen.findByText('an@pmh.com.vn');
    expect(screen.queryByRole('region', { current: true })).toBeNull();
  });
});

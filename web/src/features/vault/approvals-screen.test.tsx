import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { ApprovalsScreen, logFilterQuery } from './approvals-screen';

function row(id: string, requester: string) {
  return {
    id,
    kind: 'break_glass',
    state: 'pending',
    requester,
    requesterName: requester,
    subjectType: 'device',
    subjectId: `${id}-0000-4000-8000-000000000001`,
    subjectLabel: `SW-E2E-${id} · Switch · HCM`,
    secretCount: 1,
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

function renderAt(entry: string, rows = [row('a1', 'an@pmh.com.vn'), row('b2', 'binh@pmh.com.vn')]) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, rows))));
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

/** VLT-003 + bốn mắt: thẻ nói máy nào, và phiếu của chính mình không bày nút Duyệt. */
describe('Thẻ phiếu chờ duyệt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đối tượng là link tới hồ sơ, thẻ có đường sang trang chi tiết', async () => {
    renderAt('/approvals');
    const link = await screen.findByRole('link', { name: 'SW-E2E-a1 · Switch · HCM' });
    expect(link.getAttribute('href')).toMatch(/^\/devices\/a1-/);
    expect(screen.getAllByRole('link', { name: 'Xem chi tiết' })[0]).toHaveAttribute(
      'href',
      '/approvals/a1',
    );
  });

  it('phiếu của chính mình: "Cần người khác duyệt", không có Duyệt/Từ chối', async () => {
    renderAt('/approvals', [row('a1', 'sa@pmh.com.vn')]);
    expect(await screen.findByText('Cần người khác duyệt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  });
});

function renderRouted(me: Me, routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return Promise.resolve(jsonResponse(200, key ? routes[key] : []));
    }),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={['/approvals']}>
      <ToastProvider>
        <ApprovalsScreen me={me} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Thẻ và sổ của màn Duyệt yêu cầu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('thẻ chờ duyệt: Từ chối đứng TRƯỚC Duyệt (Duyệt ở vùng ngón cái), Từ chối không đỏ đặc', async () => {
    renderAt('/approvals', [row('a1', 'an@pmh.com.vn')]);
    const card = await screen.findByRole('region', { name: /an@pmh\.com\.vn/ });
    const buttons = within(card).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Từ chối', 'Duyệt']);
    expect(buttons[0]).toHaveClass('danger-ghost');
    expect(within(card).getByText('Thời hạn xin')).toBeInTheDocument();
  });

  it('phiếu của chính mình ở hàng chờ: rút được ngay tại đó', async () => {
    renderAt('/approvals', [row('a1', 'sa@pmh.com.vn')]);
    expect(await screen.findByRole('button', { name: 'Rút yêu cầu' })).toBeInTheDocument();
  });

  it('Nhật ký chỉ đọc: phiếu đang chờ không có nút Duyệt, chỉ có đường sang tab Chờ duyệt', async () => {
    renderRouted(ME, {
      '/api/v1/vault/break-glass/pending': [],
      '/api/v1/vault/break-glass/log': { items: [row('a1', 'an@pmh.com.vn')], total: 1 },
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Nhật ký' }));
    expect(await screen.findByRole('button', { name: 'Đi tới Chờ duyệt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  });

  it('Nhật ký: phiếu đã thu hồi nói lúc bị cắt, không in hạn gốc như thể quyền còn chạy', async () => {
    const revoked = {
      ...row('a1', 'an@pmh.com.vn'),
      state: 'revoked',
      decidedBy: 'sa@pmh.com.vn',
      decidedAt: '2026-09-20T02:00:00.000Z',
      expiresAt: '2026-09-20T06:00:00.000Z',
      updatedAt: '2026-09-20T02:30:00.000Z',
    };
    renderRouted(ME, {
      '/api/v1/vault/break-glass/pending': [],
      '/api/v1/vault/break-glass/log': { items: [revoked], total: 1 },
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Nhật ký' }));
    expect(await screen.findByText(/^Đã cắt lúc 20\/09\/2026 09:30$/)).toBeInTheDocument();
    expect(screen.queryByText('20/09/2026 13:00')).not.toBeInTheDocument();
  });

  it('Member: tiêu đề "Yêu cầu xem két", không có thanh tab một-tab, thẻ đã duyệt có nút Mở két', async () => {
    const member = { role: 'member', csrfToken: 't', email: 'an@pmh.com.vn' } as unknown as Me;
    const approved = {
      ...row('a1', 'an@pmh.com.vn'),
      state: 'approved',
      active: true,
      expiresAt: '2026-09-20T06:00:00.000Z',
    };
    renderRouted(member, { '/api/v1/vault/break-glass/mine': { items: [approved], total: 1 } });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Xin mở két' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Mở két' })).toHaveAttribute(
      'href',
      '/devices/a1-0000-4000-8000-000000000001?tab=vault',
    );
  });
});

describe('VLT-019 · bộ lọc nhật ký mở két', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [{ state: '', requester: '', from: '', to: '' }, ''],
    [
      { state: 'expired', requester: ' an@ ', from: '2026-09-01', to: '2026-09-30' },
      'state=expired&requester=an%40&from=2026-09-01&to=2026-09-30',
    ],
  ])('logFilterQuery(%j) → %s', (filters, expected) => {
    expect(logFilterQuery(filters)).toBe(expected);
  });

  it('gõ người xin → lượt gọi nhật ký mang ?requester=', async () => {
    renderRouted(ME, {
      '/api/v1/vault/break-glass/pending': [],
      '/api/v1/vault/break-glass/log': { items: [row('a1', 'an@pmh.com.vn')], total: 1 },
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Nhật ký' }));
    await userEvent.type(
      await screen.findByRole('searchbox', { name: 'Tìm theo email người xin' }),
      'an@',
    );
    const fetchMock = vi.mocked(fetch);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes('/break-glass/log?') && String(url).includes('requester=an%40'),
        ),
      ).toBe(true),
    );
  });
});

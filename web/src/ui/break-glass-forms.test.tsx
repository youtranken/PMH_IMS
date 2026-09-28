import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { DecisionDialog, type BreakGlassRow } from '@/ui/break-glass';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { VaultPanel, type AccessVerdict, type SecretMeta } from '@/ui/vault-panel';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * Hai hộp của luồng break-glass báo lỗi bằng tiếng Việt dưới từng ô (B1) — không để trình duyệt
 * chen bong bóng tiếng Anh, và không âm thầm đổi một con số gõ sai thành một mặc định.
 * Hộp Duyệt trên điện thoại: tiêu đề ngắn, thân hộp nhắc người xin · đối tượng · lý do (VLT-008).
 */

afterEach(() => vi.unstubAllGlobals());

const ROW: BreakGlassRow = {
  id: 'r1',
  kind: 'break_glass',
  state: 'pending',
  requester: 'e2e-member@pmh.com.vn',
  requesterName: 'Trần Thị B',
  subjectType: 'device',
  subjectId: 'd1',
  subjectLabel: 'SW-CORE-01 · Switch lõi · HCM',
  secretCount: 2,
  reason: 'Sự cố mất kết nối tầng 3',
  payload: { hours: 4 },
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  expiresAt: null,
  createdAt: '2026-09-28T02:00:00.000Z',
  active: false,
};

function renderDecision(approve: boolean) {
  const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  renderWithI18n(
    <MemoryRouter>
      <DecisionDialog row={ROW} approve={approve} csrfToken="t" onClose={vi.fn()} onDone={vi.fn()} />
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('DecisionDialog', () => {
  it('Duyệt: tiêu đề ngắn, thân hộp nêu người xin · đối tượng · lý do', () => {
    renderDecision(true);
    const dialog = screen.getByRole('dialog', { name: 'Duyệt yêu cầu' });
    expect(within(dialog).getByText('Trần Thị B')).toBeInTheDocument();
    expect(within(dialog).getByText(/e2e-member@pmh\.com\.vn/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: ROW.subjectLabel! })).toBeInTheDocument();
    expect(within(dialog).getByText(ROW.reason)).toBeInTheDocument();
  });

  it('Duyệt với số giờ "2 tiếng" → lỗi tiếng Việt dưới ô, không gửi', async () => {
    const fetchMock = renderDecision(true);
    const hours = screen.getByLabelText(/Cấp trong bao lâu/);
    await userEvent.clear(hours);
    await userEvent.type(hours, '2 tiếng');
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(screen.getByText('Số giờ phải là một số nguyên lớn hơn 0. Ví dụ: 4')).toBeInTheDocument();
    expect(hours).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hours.closest('form')).toHaveAttribute('novalidate');
  });

  it('Từ chối không ghi lý do → lỗi dưới ô lý do, không gửi', async () => {
    const fetchMock = renderDecision(false);
    expect(screen.getByRole('dialog', { name: 'Từ chối yêu cầu' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    expect(
      screen.getByText('Ghi lý do từ chối — người xin sẽ đọc câu này trong thư.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const MEMBER: Me = {
  id: 'u2',
  email: 'e2e-member@pmh.com.vn',
  fullName: 'Trần Thị B',
  role: 'member',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'csrf-1',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60 },
};

const NEEDS_APPROVAL: AccessVerdict = {
  tier: 'needs_approval',
  tierLabel: 'Cần duyệt',
  canReveal: false,
  canRequest: true,
  grant: null,
  pending: null,
};

const SECRET: SecretMeta = {
  id: 's1',
  ownerType: 'device',
  ownerId: 'd1',
  kind: 'password',
  label: 'enable',
  username: null,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-09-01T03:00:00.000Z',
  updatedAt: '2026-09-01T03:00:00.000Z',
};

function renderMemberPanel(verdict: AccessVerdict) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse(200, String(input).includes('/verdict') ? verdict : [SECRET]),
      ),
    ),
  );
  renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <VaultPanel ownerType="device" ownerId="d1" me={MEMBER} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Khung Két phía người xin (VLT-FLOW)', () => {
  const PENDING = {
    ...NEEDS_APPROVAL,
    canRequest: false,
    pending: { id: 'r1', createdAt: '2026-09-28T02:00:00.000Z' },
  };

  it('phiếu đang chờ: nói đã báo bao nhiêu người duyệt — chỉ con số', async () => {
    renderMemberPanel({ ...PENDING, notifiedApprovers: 3 });
    expect(await screen.findByText('Đã báo 3 người duyệt qua email.')).toBeInTheDocument();
  });

  it('không còn ai duyệt được → nói thẳng, không để người xin ngồi chờ vô ích', async () => {
    renderMemberPanel({ ...PENDING, notifiedApprovers: 0 });
    expect(await screen.findByText(/Hiện không có người duyệt nào đang hoạt động/)).toBeInTheDocument();
  });

  it('đã được duyệt: "được xem tới … (còn 3 giờ 52 phút)" đếm từ số giây server đưa', async () => {
    renderMemberPanel({
      ...NEEDS_APPROVAL,
      canReveal: true,
      canRequest: false,
      grant: { id: 'g1', expiresAt: '2026-09-28T06:00:00.000Z' },
      grantSecondsLeft: 3 * 3600 + 52 * 60,
    });
    expect(await screen.findByText(/\(còn 3 giờ 52 phút\)/)).toBeInTheDocument();
  });
});

describe('Hộp xin quyền xem (vault-panel)', () => {
  it('lý do ngắn + số giờ gõ chữ → hai lỗi tiếng Việt dưới hai ô, không gửi', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET') !== 'GET') return new Promise<Response>(() => {});
      if (url.includes('/verdict')) return Promise.resolve(jsonResponse(200, NEEDS_APPROVAL));
      return Promise.resolve(jsonResponse(200, [SECRET]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <VaultPanel ownerType="device" ownerId="d1" me={MEMBER} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Xin quyền xem' }));
    await userEvent.type(screen.getByLabelText(/Lý do/), 'gấp');
    const hours = screen.getByLabelText(/Xin trong bao lâu/);
    await userEvent.clear(hours);
    await userEvent.type(hours, 'hai');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));

    expect(screen.getByText('Ghi rõ lý do — người duyệt cần biết để quyết.')).toBeInTheDocument();
    expect(screen.getByText('Số giờ phải là một số nguyên lớn hơn 0. Ví dụ: 4')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

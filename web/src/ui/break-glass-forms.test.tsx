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

function renderDecision(
  approve: boolean,
  options: { revoke?: boolean; row?: BreakGlassRow; respond?: () => Promise<Response> } = {},
) {
  const fetchMock = vi.fn(
    (_url: string, _init?: RequestInit): Promise<Response> =>
      options.respond ? options.respond() : new Promise<Response>(() => {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <DecisionDialog
          row={options.row ?? ROW}
          approve={approve}
          revoke={options.revoke}
          csrfToken="t"
          onClose={onClose}
          onDone={onDone}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { fetchMock, onClose, onDone };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('DecisionDialog', () => {
  it('Duyệt: tiêu đề ngắn, thân hộp nêu người xin · đối tượng · lý do', () => {
    renderDecision(true);
    const dialog = screen.getByRole('dialog', { name: 'Duyệt mở két' });
    expect(within(dialog).getByText('Trần Thị B')).toBeInTheDocument();
    expect(within(dialog).getByText(/e2e-member@pmh\.com\.vn/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: ROW.subjectLabel! })).toBeInTheDocument();
    expect(within(dialog).getByText(ROW.reason)).toBeInTheDocument();
    expect(within(dialog).getByText('Xin 4 giờ')).toBeInTheDocument();
    // Tóm tắt là MÔ TẢ của hộp — trình đọc màn hình đọc nó ngay khi hộp mở.
    expect(dialog).toHaveAccessibleDescription(/Sự cố mất kết nối tầng 3/);
  });

  it('Duyệt: chạm nấc "2 giờ" → nút ghi rõ "Duyệt 2 giờ" và gửi đúng 2 giờ', async () => {
    const { fetchMock } = renderDecision(true);
    expect(screen.getByRole('button', { name: 'Duyệt 4 giờ' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 giờ' }));
    expect(screen.getByRole('button', { name: '2 giờ' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt 2 giờ' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/vault/break-glass/r1/approve');
    expect(sentBody(fetchMock)).toMatchObject({ hours: 2 });
  });

  it('Duyệt: không có nấc nào dài hơn số giờ đã xin', () => {
    renderDecision(true);
    const group = screen.getByRole('group', { name: 'Thời hạn cấp' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1 giờ',
      '2 giờ',
      '4 giờ · theo xin',
    ]);
  });

  it('người khác vừa quyết phiếu này → đóng hộp, không bắt bấm lại', async () => {
    const { onClose, onDone } = renderDecision(false, {
      respond: () =>
        Promise.resolve(
          jsonResponse(400, {
            code: 'APPROVAL_ALREADY_DECIDED',
            message: 'Yêu cầu này vừa được người khác xử lý. Tải lại để xem quyết định.',
          }),
        ),
    });
    await userEvent.type(screen.getByLabelText(/Lý do từ chối/), 'Lý do chưa đủ cụ thể');
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    expect(await screen.findByText(/vừa được người khác xử lý/)).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Duyệt một phiếu vừa bị rút (phiên người xin đã kết thúc) → báo rõ, đóng hộp', async () => {
    const { onClose, onDone } = renderDecision(true, {
      respond: () =>
        Promise.resolve(
          jsonResponse(409, {
            code: 'BREAK_GLASS_WITHDRAWN',
            message: 'Yêu cầu này đã được rút: phiên đăng nhập của người xin đã kết thúc.',
          }),
        ),
    });
    await userEvent.click(screen.getByRole('button', { name: /Duyệt/ }));
    expect(await screen.findByText(/đã được rút/)).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Thu hồi sớm: bắt ghi lý do, rồi gửi lý do đó lên API', async () => {
    const approved: BreakGlassRow = {
      ...ROW,
      state: 'approved',
      active: true,
      decidedBy: 'sa@pmh.com.vn',
      expiresAt: '2026-09-28T06:00:00.000Z',
    };
    const { fetchMock } = renderDecision(false, { revoke: true, row: approved });
    const dialog = screen.getByRole('dialog', { name: 'Thu hồi sớm' });
    expect(within(dialog).getByText(/Quyền này ĐANG chạy/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi sớm' }));
    expect(screen.getByText(/Ghi lý do thu hồi/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Lý do thu hồi/), 'Xong việc, cắt sớm');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi sớm' }));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/vault/break-glass/r1/revoke');
    expect(sentBody(fetchMock)).toEqual({ note: 'Xong việc, cắt sớm' });
  });

  it('Duyệt với số giờ "2 tiếng" → lỗi tiếng Việt dưới ô, không gửi', async () => {
    const { fetchMock } = renderDecision(true);
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
    const { fetchMock } = renderDecision(false);
    expect(screen.getByRole('dialog', { name: 'Từ chối yêu cầu' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    expect(
      screen.getByText('Ghi lý do từ chối (từ 5 ký tự) — người xin sẽ đọc câu này trong thư.'),
    ).toBeInTheDocument();
    // Một chữ "không" không cho người xin biết phải sửa gì.
    await userEvent.type(screen.getByLabelText(/Lý do từ chối/), 'không');
    await userEvent.clear(screen.getByLabelText(/Lý do từ chối/));
    await userEvent.type(screen.getByLabelText(/Lý do từ chối/), 'khg');
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
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

    await userEvent.click(await screen.findByRole('button', { name: 'Xin mở két' }));
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

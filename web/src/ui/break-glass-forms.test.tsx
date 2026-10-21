import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { DecisionDialog, type BreakGlassRow } from '@/ui/break-glass';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { VaultPanel, type AccessVerdict, type SecretMeta } from '@/ui/vault-panel';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * Các hộp của luồng break-glass báo lỗi bằng tiếng Việt dưới từng ô (B1) — không để trình duyệt
 * chen bong bóng tiếng Anh, và không âm thầm đổi một con số gõ sai thành một mặc định.
 * Hộp Từ chối trên điện thoại: tiêu đề ngắn, thân hộp nhắc người xin · đối tượng · lý do (VLT-008).
 * Không còn hộp Duyệt (Q-30): người xin nhập mã người duyệt đọc cho, ở khung Két.
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
  it('Từ chối: tiêu đề ngắn, thân hộp nêu người xin · đối tượng · lý do', () => {
    renderDecision();
    const dialog = screen.getByRole('dialog', { name: 'Từ chối yêu cầu' });
    expect(within(dialog).getByText('Trần Thị B')).toBeInTheDocument();
    expect(within(dialog).getByText(/e2e-member@pmh\.com\.vn/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: ROW.subjectLabel! })).toBeInTheDocument();
    expect(within(dialog).getByText(ROW.reason)).toBeInTheDocument();
    expect(within(dialog).getByText('Mở trong 4 giờ')).toBeInTheDocument();
    // Tóm tắt là MÔ TẢ của hộp — trình đọc màn hình đọc nó ngay khi hộp mở.
    expect(dialog).toHaveAccessibleDescription(/Sự cố mất kết nối tầng 3/);
    // Q-30: không còn đường Duyệt trong IMS.
    expect(within(dialog).queryByRole('button', { name: /^Duyệt/ })).not.toBeInTheDocument();
  });

  it('người khác vừa quyết phiếu này → đóng hộp, không bắt bấm lại', async () => {
    const { onClose, onDone } = renderDecision({
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

  it.each([
    ['vừa bị rút (tài khoản người xin bị vô hiệu hóa)', 'BREAK_GLASS_WITHDRAWN', 'Yêu cầu này đã được rút: tài khoản của người xin đã bị vô hiệu hóa.', /đã được rút/],
    ['vừa hết hạn chờ (Q-15)', 'BREAK_GLASS_PENDING_EXPIRED', 'Yêu cầu này đã quá 8 giờ không ai duyệt nên tự hết hạn.', /không ai duyệt/],
  ])('Từ chối một phiếu %s → báo rõ, đóng hộp', async (_label, code, message, shown) => {
    const { onClose, onDone } = renderDecision({
      respond: () => Promise.resolve(jsonResponse(409, { code, message })),
    });
    await userEvent.type(screen.getByLabelText(/Lý do từ chối/), 'Không cần nữa rồi');
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }));
    expect(await screen.findByText(shown)).toBeInTheDocument();
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
    const { fetchMock } = renderDecision({ revoke: true, row: approved });
    const dialog = screen.getByRole('dialog', { name: 'Thu hồi sớm' });
    expect(within(dialog).getByText(/Quyền này đang có hiệu lực/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi sớm' }));
    expect(screen.getByText(/Ghi lý do thu hồi/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Lý do thu hồi/), 'Xong việc, cắt sớm');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Thu hồi sớm' }));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/vault/break-glass/r1/revoke');
    expect(sentBody(fetchMock)).toEqual({ note: 'Xong việc, cắt sớm' });
  });

  it('Từ chối không ghi lý do → lỗi dưới ô lý do, không gửi', async () => {
    const { fetchMock } = renderDecision();
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
  features: null,
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'csrf-1',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
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

function renderMemberPanel(
  verdict: AccessVerdict,
  respond: (url: string, init?: RequestInit) => Promise<Response> | null = () => null,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return (
      respond(url, init) ??
      Promise.resolve(jsonResponse(200, url.includes('/verdict') ? verdict : [SECRET]))
    );
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
  return fetchMock;
}

describe('Khung Két phía người xin (VLT-FLOW)', () => {
  const PENDING = {
    ...NEEDS_APPROVAL,
    canRequest: false,
    pending: { id: 'r1', createdAt: '2026-09-28T02:00:00.000Z' },
  };

  const CODE = {
    approver: 'sa@pmh.com.vn',
    approverName: 'Cao Thuận',
    approverActive: true,
    resendsLeft: 3,
    attemptsLeft: 5,
    codeSecondsLeft: 540,
  };
  const WITH_CODE: AccessVerdict = { ...PENDING, pendingCode: CODE };

  it('phiếu đang chờ (Q-30, gọn chữ): một dòng mã gửi cho ai + đồng hồ; chưa sai thì không nói số lượt', async () => {
    renderMemberPanel(WITH_CODE);
    expect(await screen.findByText('Đã gửi mã cho Cao Thuận · còn 9:00')).toBeInTheDocument();
    expect(screen.queryByText(/lần nhập/)).not.toBeInTheDocument();
    // Ba nút cùng một hàng; không còn câu "có thể đóng trang" hay link "Xem yêu cầu".
    for (const name of ['Xác nhận', 'Gửi lại mã (3)', 'Rút yêu cầu']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/có thể đóng trang/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Xem yêu cầu' })).not.toBeInTheDocument();
  });

  it('đã sai một lần: hiện "còn N lần nhập"', async () => {
    renderMemberPanel({ ...PENDING, pendingCode: { ...CODE, attemptsLeft: 4 } });
    expect(await screen.findByText('Còn 4 lần nhập.')).toBeInTheDocument();
  });

  it('thư chưa đi → nói đang gửi, không đếm lùi một mã chưa có', async () => {
    renderMemberPanel({ ...PENDING, pendingCode: { ...CODE, codeSecondsLeft: null } });
    expect(await screen.findByText('Đang gửi mã cho Cao Thuận…')).toBeInTheDocument();
  });

  it('gõ đủ 6 số → gửi đúng mã lên /code của đúng phiếu', async () => {
    const fetchMock = renderMemberPanel(WITH_CODE, (url, init) =>
      init?.method === 'POST' && url.endsWith('/r1/code') ? Promise.resolve(jsonResponse(200, { id: 'r1' })) : null,
    );
    await screen.findByText(/Đã gửi mã cho/);
    await userEvent.type(screen.getAllByRole('textbox')[0], '012345');
    const post = await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/r1/code') && i?.method === 'POST');
      if (!call) throw new Error('chưa gửi');
      return call;
    });
    expect(JSON.parse(String(post[1]!.body))).toEqual({ code: '012345' });
    expect(await screen.findByText('Đã được duyệt — bấm "Xem" ở ngăn cần mở.')).toBeInTheDocument();
  });

  it('sai mã → câu lỗi của server dưới ô, ô được xoá để gõ lại', async () => {
    renderMemberPanel(WITH_CODE, (url, init) =>
      init?.method === 'POST' && url.endsWith('/r1/code')
        ? Promise.resolve(jsonResponse(400, { code: 'BREAK_GLASS_CODE_WRONG', message: 'Mã không đúng. Còn 4 lần nhập.' }))
        : null,
    );
    await screen.findByText(/Đã gửi mã cho/);
    await userEvent.type(screen.getAllByRole('textbox')[0], '999999');
    expect(await screen.findByText('Mã không đúng. Còn 4 lần nhập.')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('');
  });

  it('"Gửi lại mã" gọi /resend-code; hết lượt thì nút tắt', async () => {
    const fetchMock = renderMemberPanel(WITH_CODE, (url, init) =>
      init?.method === 'POST' && url.endsWith('/r1/resend-code') ? Promise.resolve(jsonResponse(200, { resendsLeft: 2 })) : null,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Gửi lại mã (3)' }));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/r1/resend-code') && i?.method === 'POST')).toBe(true),
    );
    expect(await screen.findByText('Đã gửi mã mới tới Cao Thuận. Mã cũ không còn dùng được.')).toBeInTheDocument();
  });

  it('phiếu gửi trước khi có duyệt bằng mã: nói rõ phải rút rồi gửi lại, không để chờ mã không bao giờ tới', async () => {
    renderMemberPanel({ ...PENDING, pendingCode: null });
    expect(await screen.findByText(/gửi trước khi đổi sang duyệt bằng mã/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Mã duyệt/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rút yêu cầu' })).toBeInTheDocument();
  });

  it('người duyệt đã mất quyền duyệt: nói ai, bảo rút và chọn người khác; không còn ô nhập mã', async () => {
    renderMemberPanel({ ...PENDING, pendingCode: { ...CODE, approverActive: false } });
    expect(await screen.findByText(/Cao Thuận không còn là Super Admin \/ Quản trị đang hoạt động/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Mã duyệt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gửi lại mã/ })).not.toBeInTheDocument();
  });

  it('hết lượt gửi lại → nút tắt, nói rõ', async () => {
    renderMemberPanel({ ...PENDING, pendingCode: { ...CODE, resendsLeft: 0 } });
    expect(await screen.findByRole('button', { name: 'Gửi lại mã (0)' })).toBeDisabled();
  });

  it('đã được duyệt: một dòng "Đang mở két · còn 3:52" đếm từ số giây server đưa', async () => {
    renderMemberPanel({
      ...NEEDS_APPROVAL,
      canReveal: true,
      canRequest: false,
      grant: { id: 'g1', expiresAt: '2026-09-28T06:00:00.000Z' },
      grantSecondsLeft: 3 * 3600 + 52 * 60,
    });
    expect(await screen.findByText('Đang mở két · còn 3:52')).toBeInTheDocument();
  });
});

describe('Hộp xin quyền xem (vault-panel)', () => {
  it('hộp xin chỉ ba ô (Q-30 gọn chữ); lý do ngắn + chưa chọn người duyệt → lỗi dưới ô, không gửi', async () => {
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
    const dialog = screen.getByRole('dialog');
    // Không còn ô gõ số giờ, không còn đoạn giải thích: chỉ Lý do là ô chữ.
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(within(dialog).getByRole('group', { name: 'Mở trong' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Chọn một SA\/Quản trị để duyệt/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Lý do/), 'gấp');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));

    expect(screen.getByText('Ghi rõ lý do — người duyệt cần biết để quyết.')).toBeInTheDocument();
    expect(screen.getByText('Chọn người duyệt — chỉ người này nhận thư có mã.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

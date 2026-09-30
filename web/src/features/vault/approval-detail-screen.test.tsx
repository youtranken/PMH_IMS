import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ApprovalDetailScreen } from './approval-detail-screen';

/**
 * Trang chi tiết một phiếu — đích của nút "Xem và duyệt" trong thư (VLT-FLOW, VLT-002).
 *
 * Người duyệt quyết trên điện thoại: đối tượng đọc được thay cho uuid, thanh quyết định có
 * "Từ chối" / "Duyệt n giờ", chạm lần hai mới cấp, và step-up hỏi mã NGAY TẠI CHỖ thay vì
 * một dòng lỗi không có ô nhập.
 */

const SA: Me = {
  id: 'u1',
  email: 'sa@pmh.com.vn',
  fullName: 'Lê Minh',
  role: 'sa',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'csrf-1',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

const ROW = {
  id: 'a1',
  kind: 'break_glass',
  state: 'pending',
  requester: 'tran.b@pmh.com.vn',
  requesterName: 'Trần Thị B',
  subjectType: 'device',
  subjectId: 'd1',
  subjectLabel: 'SW-CORE-01 · Switch lõi tầng 3 · HCM',
  secretCount: 2,
  reason: 'Switch tầng 3 mất kết nối',
  payload: { hours: 4 },
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  expiresAt: null,
  createdAt: '2026-09-20T01:30:00.000Z',
  active: false,
};

type Call = { url: string; method: string; body?: string };

function mockApi(row: Record<string, unknown>, approveReplies: Response[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (method === 'GET' && url.endsWith('/vault/break-glass/a1')) {
        return Promise.resolve(jsonResponse(200, row));
      }
      if (method === 'POST' && url.endsWith('/approve')) {
        return Promise.resolve(
          approveReplies.shift() ?? jsonResponse(201, { ...row, state: 'approved' }),
        );
      }
      return new Promise<Response>(() => {});
    }),
  );
  return calls;
}

function renderDetail(me: Me = SA) {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/approvals/a1']}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/approvals/:id" element={<ApprovalDetailScreen me={me} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Trang chi tiết phiếu break-glass', () => {
  it('nói máy nào (link hồ sơ), lý do, và mặc định cấp đúng số giờ xin', async () => {
    mockApi(ROW);
    renderDetail();

    const subject = await screen.findByRole('link', { name: ROW.subjectLabel });
    expect(subject).toHaveAttribute('href', '/devices/d1');
    expect(screen.getByText('Switch tầng 3 mất kết nối')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 giờ · theo xin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Chỉ RÚT NGẮN được — không có nấc nào dài hơn số xin.
    expect(screen.queryByRole('button', { name: '8 giờ' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duyệt 4 giờ' })).toBeInTheDocument();
  });

  it('chạm lần đầu chỉ hỏi lại; chạm lần hai mới gửi, với số giờ đã chọn', async () => {
    const calls = mockApi(ROW);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '2 giờ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt 2 giờ' }));
    expect(calls.some((c) => c.url.endsWith('/approve'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Chạm lần nữa để cấp 2 giờ' }));
    const approve = calls.find((c) => c.url.endsWith('/approve'));
    expect(approve?.url).toContain('/vault/break-glass/a1/approve');
    expect(JSON.parse(approve?.body ?? '{}')).toMatchObject({ hours: 2 });
  });

  it('server đòi step-up → hỏi mã 6 số ngay tại chỗ, không phải một dòng lỗi', async () => {
    mockApi(ROW, [
      jsonResponse(403, { code: 'STEPUP_REQUIRED', message: 'Nhập mã 6 số trên ứng dụng xác thực.' }),
    ]);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Duyệt 4 giờ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Chạm lần nữa để cấp 4 giờ' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/mã/i)).toBeInTheDocument();
  });

  it('phiếu của chính mình: không có nút Duyệt, chỉ "Cần người khác duyệt" và Rút yêu cầu', async () => {
    mockApi({ ...ROW, requester: 'sa@pmh.com.vn', requesterName: 'Lê Minh' });
    renderDetail();

    expect(await screen.findByText('Cần người khác duyệt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rút yêu cầu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Duyệt/ })).not.toBeInTheDocument();
  });

  it('phiếu đã có người quyết: hiện trạng thái cuối, không còn nút quyết', async () => {
    mockApi({
      ...ROW,
      state: 'denied',
      decidedBy: 'admin@pmh.com.vn',
      decidedAt: '2026-09-20T01:40:00.000Z',
      decisionNote: 'Lý do chưa đủ cụ thể',
    });
    renderDetail();

    expect(await screen.findByText(/Đã từ chối bởi admin@pmh.com.vn/)).toBeInTheDocument();
    expect(screen.getByText('Lý do chưa đủ cụ thể', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Duyệt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  });

  it('từ chối mà không ghi lý do → báo lỗi, KHÔNG gọi API', async () => {
    const calls = mockApi(ROW);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Từ chối' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Ghi lý do từ chối/);
    expect(calls.some((c) => c.url.endsWith('/deny'))).toBe(false);
  });
});

describe('Ngữ cảnh để quyết nhanh (VLT-FLOW)', () => {
  it('đầu trang nói phiếu đã chờ bao lâu, giờ tuyệt đối nằm trong title', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-20T01:34:30.000Z'));
    mockApi(ROW);
    renderDetail();
    const ago = await screen.findByText('Gửi 4 phút trước');
    expect(ago.tagName).toBe('TIME');
    expect(ago).toHaveAttribute('dateTime', ROW.createdAt);
    expect(ago.getAttribute('title')).toMatch(/20\/09\/2026/);
  });

  it('người duyệt thấy vai người xin và "lần thứ N trong X ngày" — chỉ con số', async () => {
    mockApi({ ...ROW, requesterRole: 'member', recentCount: 3, recentWindowDays: 30 });
    renderDetail();
    const block = await screen.findByRole('region', { name: 'Người xin' });
    expect(within(block).getByText('Thành viên')).toBeInTheDocument();
    expect(within(block).getByText('Lần xin thứ 3 trong 30 ngày qua')).toBeInTheDocument();
  });

  it('lần đầu thì nói lần đầu; server không gửi (người xin tự xem) thì không bịa', async () => {
    mockApi({ ...ROW, requesterRole: 'member', recentCount: 1, recentWindowDays: 30 });
    const view = renderDetail();
    expect(await screen.findByText('Lần xin đầu tiên trong 30 ngày qua')).toBeInTheDocument();
    view.unmount();

    mockApi({ ...ROW, requesterRole: null, recentCount: null, recentWindowDays: null });
    renderDetail();
    await screen.findByRole('region', { name: 'Người xin' });
    expect(screen.queryByText(/Lần xin/)).toBeNull();
  });

  it('phiếu đã thu hồi: diễn biến nói ai duyệt, AI THU HỒI, lúc nào', async () => {
    mockApi({
      ...ROW,
      state: 'revoked',
      decidedBy: 'sa@pmh.com.vn',
      decidedAt: '2026-09-20T01:40:00.000Z',
      timeline: [
        { state: 'approved', actor: 'sa@pmh.com.vn', at: '2026-09-20T01:40:00.000Z', note: null },
        {
          state: 'revoked',
          actor: 'admin@pmh.com.vn',
          at: '2026-09-20T02:05:00.000Z',
          note: 'Xong việc',
        },
      ],
    });
    renderDetail();
    const block = await screen.findByRole('region', { name: 'Diễn biến' });
    const steps = within(block).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[2]).toHaveTextContent('Thu hồi sớm · admin@pmh.com.vn · 20/09/2026 09:05');
    expect(steps[2]).toHaveTextContent('Xong việc');
  });

  it('thu hồi sớm từ trang chi tiết: mở hộp bắt ghi lý do, không phải một câu "chắc chưa?"', async () => {
    mockApi({
      ...ROW,
      state: 'approved',
      active: true,
      decidedBy: 'admin@pmh.com.vn',
      expiresAt: '2026-09-20T05:30:00.000Z',
    });
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Thu hồi sớm' }));
    const dialog = screen.getByRole('dialog', { name: 'Thu hồi sớm' });
    expect(within(dialog).getByLabelText(/Lý do thu hồi/)).toBeInTheDocument();
  });
});

/**
 * Q-15 — phía NGƯỜI XIN: yêu cầu chờ không gắn phiên, được duyệt thì mở lại đối tượng và bấm
 * "Xem" (không có nút riêng); phiếu chờ quá hạn thì tự hết hạn.
 */
describe('Trang chi tiết phiếu — người xin (Q-15)', () => {
  const MEMBER: Me = { ...SA, email: 'tran.b@pmh.com.vn', fullName: 'Trần Thị B', role: 'member' };

  it('đang chờ: nói cứ đóng trang, được duyệt sẽ có thư', async () => {
    mockApi(ROW);
    renderDetail(MEMBER);
    expect(await screen.findByText(/Bạn có thể đóng trang/)).toBeInTheDocument();
  });

  it('đã duyệt, chưa xem: chỉ đường "mở lại <đối tượng>, bấm Xem, nhập mã 6 số" + nút Mở két', async () => {
    mockApi({
      ...ROW,
      state: 'approved',
      active: true,
      decidedBy: 'admin@pmh.com.vn',
      expiresAt: '2026-09-20T05:30:00.000Z',
      claimedAt: null,
    });
    renderDetail(MEMBER);
    expect(
      await screen.findByText(/Đã duyệt\. Mở lại SW-CORE-01 · Switch lõi tầng 3 · HCM, bấm "Xem"/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở két' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nhận quyền/ })).not.toBeInTheDocument();
  });

  it('đã xem lần đầu: nói quyền gắn với phiên đang dùng', async () => {
    mockApi({
      ...ROW,
      state: 'approved',
      active: true,
      decidedBy: 'admin@pmh.com.vn',
      expiresAt: '2026-09-20T05:30:00.000Z',
      claimedAt: '2026-09-20T02:00:00.000Z',
    });
    renderDetail(MEMBER);
    expect(await screen.findByText(/gắn với phiên đăng nhập này/)).toBeInTheDocument();
    expect(screen.queryByText(/Đã duyệt\. Mở lại/)).not.toBeInTheDocument();
  });

  it('hết hạn chờ (chưa từng được duyệt): nói không ai duyệt, không nói "quyền đã tự cắt"', async () => {
    mockApi({ ...ROW, state: 'expired', decidedBy: 'system', decidedAt: '2026-09-20T09:31:00.000Z' });
    renderDetail(MEMBER);
    expect(await screen.findByText(/không ai duyệt/)).toBeInTheDocument();
    expect(screen.queryByText(/quyền đã tự cắt/)).not.toBeInTheDocument();
  });

  it('diễn biến có mốc "xem lần đầu"', async () => {
    mockApi({
      ...ROW,
      state: 'expired',
      decidedBy: 'sa@pmh.com.vn',
      expiresAt: '2026-09-20T05:30:00.000Z',
      timeline: [
        { state: 'approved', actor: 'sa@pmh.com.vn', at: '2026-09-20T01:40:00.000Z', note: null },
        { state: 'claimed', actor: 'tran.b@pmh.com.vn', at: '2026-09-20T01:50:00.000Z', note: null },
      ],
    });
    renderDetail();
    const block = await screen.findByRole('region', { name: 'Diễn biến' });
    expect(within(block).getByText(/Xem lần đầu — quyền gắn vào phiên đăng nhập/)).toBeInTheDocument();
  });
});

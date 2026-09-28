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
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60 },
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

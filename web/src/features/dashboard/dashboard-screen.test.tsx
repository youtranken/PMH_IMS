import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { DashboardScreen } from './dashboard-screen';

/**
 * Bảng điều khiển đọc trong ba phút: tên trang luôn có, hàng số PHÂN LOẠI (quá hạn tách khỏi
 * sắp hết hạn), khối lỗi không trông như tin tốt, dòng break-glass nói tên người và đối tượng,
 * không in mã thô.
 */

const ADMIN: Me = {
  id: 'u1',
  email: 'sep@pmh.com.vn',
  fullName: 'Trần Sếp',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'c',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

const EMPTY = { available: true, items: [], total: 0 };

function expiringItem(id: string, daysLeft: number) {
  return {
    kind: 'license',
    id,
    label: `LIC-${id}`,
    endDate: '2026-10-10',
    daysLeft,
    link: null,
    canRenew: false,
  };
}

const BOARD = {
  expiring: {
    available: true,
    total: 19,
    overdueTotal: 3,
    items: [expiringItem('a', -40), expiringItem('b', 5)],
  },
  incidents: { available: false, items: [], total: 0 },
  breakGlass: {
    available: true,
    total: 1,
    items: [
      {
        id: 'bg1',
        requester: 'lan@pmh.com.vn',
        requesterName: 'Nguyễn Thị Lan',
        subjectType: 'service_account',
        subjectId: 'sa1',
        subjectLabel: 'VPN-01 · VPN chi nhánh',
        reason: 'sự cố VPN',
        state: 'approved',
        active: true,
        decidedBy: 'sep@pmh.com.vn',
        decidedByName: 'Trần Sếp',
        createdAt: '2026-09-20T01:30:00.000Z',
        expiresAt: '2026-09-20T05:30:00.000Z',
      },
    ],
  },
  subnetLoad: { available: false, items: [], total: 0, thresholdPercent: null },
  staleSecrets: EMPTY,
  disposed: {
    available: true,
    total: 1,
    items: [
      { kind: 'service_account', id: 'x', code: 'VPN-OLD', name: 'VPN cũ', detail: 'vpn', updatedAt: '2026-09-27' },
    ],
  },
};

function mockApi(board: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/dashboard')) return Promise.resolve(jsonResponse(status, board));
      if (url.includes('/break-glass/mine')) return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
}

function renderBoard() {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <DashboardScreen me={ADMIN} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Bảng điều khiển', () => {
  it('API lỗi → vẫn có tiêu đề trang + khối lỗi có Thử lại, không trắng trang', async () => {
    mockApi({ message: 'x' }, 500);
    renderBoard();
    expect(screen.getByRole('heading', { level: 1, name: 'Bảng điều khiển' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('hàng số tách "Đã quá hạn" khỏi "Sắp hết hạn"; khối hạn chia hai nhóm có số', async () => {
    mockApi(BOARD);
    renderBoard();
    const overdue = await screen.findByRole('link', { name: /^3\s*Đã quá hạn/ });
    expect(overdue).toHaveAttribute('href', '/expiry?state=expired');
    expect(screen.getByRole('link', { name: /^16\s*Sắp hết hạn/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Tổng hợp hết hạn cần xử lý' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đã quá hạn (3)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sắp tới (16)' })).toBeInTheDocument();
    expect(screen.getByText('Xin chào, Trần Sếp', { exact: false })).toBeInTheDocument();
  });

  it('dòng mở két: TÊN người xin, đối tượng là link, trạng thái "Đã duyệt" có màu, không email trần', async () => {
    mockApi(BOARD);
    renderBoard();
    const block = (await screen.findByRole('heading', { name: 'Yêu cầu mở két tuần qua' })).closest('section')!;
    expect(within(block).getByText('Nguyễn Thị Lan')).toHaveAttribute('title', 'lan@pmh.com.vn');
    expect(within(block).getByRole('link', { name: 'VPN-01 · VPN chi nhánh' })).toBeInTheDocument();
    expect(within(block).getByText('Đã duyệt')).toHaveClass('ok');
    expect(within(block).queryByText('lan@pmh.com.vn')).toBeNull();
  });

  it('khối thanh lý không in mã loại thô ("vpn")', async () => {
    mockApi(BOARD);
    renderBoard();
    const block = (await screen.findByRole('heading', { name: 'Tổng hợp kho thanh lý (7 ngày)' })).closest('section')!;
    expect(within(block).getByText(/Tài khoản VPN/)).toBeInTheDocument();
    expect(within(block).queryByText(/^vpn/)).toBeNull();
  });

  it('khối LỖI có tông cảnh báo + Thử lại; khối chưa có (Sự cố) là thông tin — không cùng kiểu với tin tốt', async () => {
    mockApi({ ...BOARD, disposed: { available: false, items: [], total: 0 } });
    renderBoard();
    const errorBlock = (await screen.findByRole('heading', { name: 'Tổng hợp kho thanh lý (7 ngày)' })).closest('section')!;
    expect(errorBlock).toHaveClass('tone-error');
    expect(within(errorBlock).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    const incidents = screen.getByRole('heading', { name: 'Sự cố tuần qua' }).closest('section')!;
    expect(incidents).toHaveClass('tone-info');
    expect(incidents).toHaveTextContent('IMS chưa theo dõi sự cố.');
  });

  it('người xin có yêu cầu đang chờ → khối "Yêu cầu mở két của tôi" ở đầu trang; không có thì không có khối', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/dashboard')) return Promise.resolve(jsonResponse(200, BOARD));
        if (url.includes('/break-glass/mine'))
          return Promise.resolve(
            jsonResponse(200, {
              total: 2,
              items: [
                { ...BOARD.breakGlass.items[0], id: 'm1', state: 'pending', active: false, secretCount: null, payload: null },
                { ...BOARD.breakGlass.items[0], id: 'm2', state: 'denied', active: false, secretCount: null, payload: null },
              ],
            }),
          );
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderBoard();
    const block = (await screen.findByRole('heading', { name: 'Yêu cầu mở két của tôi' })).closest('section')!;
    expect(within(block).getByText('Chờ duyệt')).toBeInTheDocument();
    // Phiếu đã bị từ chối là chuyện đã xong — không chiếm chỗ đầu trang.
    expect(within(block).queryByText('Đã từ chối')).toBeNull();
  });

  it('phiếu đã duyệt mà chưa xem lần nào → nói bước tiếp theo "mở két, bấm Xem" (Q-15)', async () => {
    const base = { ...BOARD.breakGlass.items[0], secretCount: null, payload: null };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/dashboard')) return Promise.resolve(jsonResponse(200, BOARD));
        if (url.includes('/break-glass/mine'))
          return Promise.resolve(
            jsonResponse(200, {
              total: 2,
              items: [
                { ...base, id: 'm1', state: 'approved', active: true, claimedAt: null },
                { ...base, id: 'm2', state: 'approved', active: true, claimedAt: '2026-09-20T02:00:00.000Z' },
              ],
            }),
          );
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderBoard();
    const block = (await screen.findByRole('heading', { name: 'Yêu cầu mở két của tôi' })).closest('section')!;
    expect(within(block).getAllByText(/đã duyệt — mở két, bấm "Xem"/)).toHaveLength(1);
  });
});

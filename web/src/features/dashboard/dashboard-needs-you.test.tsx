import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DashboardScreen } from './dashboard-screen';

/**
 * DASH-001 — việc gấp nhất của người duyệt đứng ĐẦU bảng điều khiển, có nút ngay tại chỗ. Q-30:
 * chỉ phiếu chọn ĐÚNG mình duyệt, không có nút Duyệt (đồng ý = đọc mã trong thư cho người xin).
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

const EMPTY = { available: true, items: [], total: 0 };
const BOARD = {
  expiring: EMPTY,
  incidents: { available: false, items: [], total: 0 },
  breakGlass: EMPTY,
  subnetLoad: EMPTY,
  staleSecrets: EMPTY,
  disposed: EMPTY,
};

function request(id: string, requester: string, name: string, approver = 'sa@pmh.com.vn') {
  return {
    id,
    kind: 'break_glass',
    state: 'pending',
    requester,
    requesterName: name,
    subjectType: 'device',
    subjectId: `${id}-d`,
    subjectLabel: `SW-${id} · Switch lõi · HCM`,
    secretCount: 2,
    reason: 'Switch tầng 3 mất kết nối',
    payload: { hours: 4 },
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    expiresAt: null,
    createdAt: '2026-09-20T01:30:00.000Z',
    active: false,
    approver,
  };
}

function mockApi(pending: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/dashboard')) return Promise.resolve(jsonResponse(200, BOARD));
      if (url.endsWith('/break-glass/pending')) return Promise.resolve(jsonResponse(200, pending));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
}

function renderBoard(me: Me = SA) {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <DashboardScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Khối "Cần bạn duyệt"', () => {
  it('đứng đầu trang, chỉ phiếu chọn mình duyệt, chỉ có Từ chối (không có Duyệt) và đối tượng', async () => {
    mockApi([
      request('a1', 'tran.b@pmh.com.vn', 'Trần Thị B'),
      request('a2', 'nguyen.c@pmh.com.vn', 'Nguyễn Văn C', 'admin@pmh.com.vn'),
    ]);
    renderBoard();

    const block = await screen.findByRole('region', { name: 'Cần bạn duyệt (1)' });
    expect(within(block).getByText('Trần Thị B')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'SW-a1 · Switch lõi · HCM' })).toBeInTheDocument();
    expect(within(block).queryByText('SW-a2 · Switch lõi · HCM')).not.toBeInTheDocument();
    expect(within(block).getByText(/đọc mã trong thư cho người xin/)).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();

    await userEvent.click(within(block).getByRole('button', { name: 'Từ chối' }));
    expect(await screen.findByRole('dialog', { name: 'Từ chối yêu cầu' })).toBeInTheDocument();
  });

  it('không có gì chờ → không có khối', async () => {
    mockApi([]);
    renderBoard();
    await screen.findByRole('heading', { level: 1, name: 'Bảng điều khiển' });
    expect(screen.queryByRole('region', { name: /Cần bạn duyệt/ })).not.toBeInTheDocument();
  });
});

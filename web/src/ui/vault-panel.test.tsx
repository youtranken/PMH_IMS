import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { VaultPanel, type AccessVerdict, type SecretMeta } from '@/ui/vault-panel';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * BA HỘP CỦA KÉT SẮT PHẢI KHÓA LẠI KHI LƯỢT GHI ĐANG BAY.
 *
 * ===== CẢNH THẬT =====
 *
 * Gõ mật khẩu mới → bấm Xoay → gõ mã 6 số → trong lúc `rotate.mutateAsync` còn đang bay, bấm
 * Esc / click nền / bấm Hủy. Hộp biến mất; POST vẫn hoàn tất; secret ĐÃ bị xoay thật. Nhưng
 * `onSaved()` không bao giờ chạy: không toast, không refresh danh sách. Người vận hành tin là
 * mình vừa hủy, và giá trị cũ — thứ họ đang dán vào cấu hình thiết bị — đã không còn đúng nữa.
 *
 * Đây đúng là lớp lỗi mà `dismissible={!busy}` sinh ra để chặn, và đợt này đã gắn nó cho 17
 * hộp khác. Ba hộp của két sắt bị bỏ sót — đúng ba hộp vừa được chuyển sang `mutateAsync` +
 * `stepUp.run`, tức đúng ba hộp có cửa sổ "đang bay" dài nhất.
 */

const ME: Me = {
  id: 'u1',
  email: 'admin@pmh.com.vn',
  fullName: 'Quản trị',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'csrf-1',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60 },
};

const SECRET: SecretMeta = {
  id: 's1',
  ownerType: 'device',
  ownerId: 'd1',
  kind: 'password',
  label: 'admin web',
  username: 'admin',
  note: null,
  createdBy: 'u1',
  createdAt: '2026-09-01T03:00:00.000Z',
  updatedAt: '2026-09-01T03:00:00.000Z',
};

const WHITELIST: AccessVerdict = {
  tier: 'whitelist',
  tierLabel: 'Được xem thẳng',
  canReveal: true,
  canRequest: false,
  grant: null,
  pending: null,
};

const NEEDS_APPROVAL: AccessVerdict = {
  tier: 'needs_approval',
  tierLabel: 'Cần duyệt',
  canReveal: false,
  canRequest: true,
  grant: null,
  pending: null,
};

/**
 * Mọi lượt GHI treo mãi mãi — đó chính là trạng thái cần kiểm: "đang bay, chưa xong".
 * Lượt ĐỌC (verdict + danh sách) trả ngay để panel dựng xong giao diện.
 */
function mockApi(verdict: AccessVerdict, rows: SecretMeta[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
      return Promise.resolve(jsonResponse(200, verdict));
    }
    if (method === 'GET' && url.includes('/vault/secrets')) {
      return Promise.resolve(jsonResponse(200, rows));
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(me: Me = ME) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <VaultPanel ownerType="device" ownerId="d1" me={me} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

/** Nút Hủy của hộp đang mở — tên khả truy cập "Hủy" (nút ✕ mang tên "Đóng"). */
const cancelButton = () => screen.getByRole('button', { name: 'Hủy' });

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VaultPanel — hộp Cất secret khóa lại khi đang ghi', () => {
  it('đang cất: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(WHITELIST, []);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Cất secret' }));
    await userEvent.type(screen.getByLabelText(/Tên gọi/), 'admin web');
    await userEvent.type(screen.getByLabelText(/Giá trị/), 'Sup3r#Secret');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    // Lượt POST đang bay: nút Lưu đã đổi sang "Đang tải…".
    await screen.findByRole('button', { name: 'Đang tải…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeInTheDocument();
  });
});

describe('VaultPanel — hộp Xoay khóa lại khi đang ghi', () => {
  it('đang xoay: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(WHITELIST, [SECRET]);
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Thao tác với admin web' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Xoay' }));
    await userEvent.type(screen.getByLabelText(/Giá trị mới/), 'N3w#Secret');
    await userEvent.click(screen.getByRole('button', { name: 'Xoay' }));

    await screen.findByRole('button', { name: 'Đang tải…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeInTheDocument();
  });
});

describe('VaultPanel — hộp Xin quyền xem khóa lại khi đang gửi', () => {
  it('đang gửi yêu cầu: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(NEEDS_APPROVAL, [SECRET]);
    renderPanel({ ...ME, role: 'member' });

    await userEvent.click(await screen.findByRole('button', { name: 'Xin quyền xem' }));
    await userEvent.type(
      screen.getByLabelText(/Lý do/),
      'switch tầng 3 mất kết nối',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));

    await screen.findByRole('button', { name: 'Đang tải…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeInTheDocument();
  });
});

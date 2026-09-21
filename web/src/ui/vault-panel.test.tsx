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

/**
 * F-07 — HAI VẾ, VÀ CHỈ MỘT VẾ LÀ LỖI THẬT.
 *
 * ===== VẾ (a): ADMIN BỊ CHẶN BỞI MỘT TRUY VẤN HỌ KHÔNG CẦN — LỖI THẬT =====
 *
 * `useOwnerSecrets` tính `allowed = isAdmin || …`, và chú thích ở đó tuyên bố thẳng: "SA/Admin
 * không chờ `verdict`: `isAdmin` đã đủ". Nhưng phần render đặt `if (verdict.isLoading)` và
 * `if (verdict.isError)` LÊN TRƯỚC mọi thứ, nên `/vault/secrets/verdict` trả 500 là SA/Admin
 * mất sạch panel Két sắt dù quyền của họ không hề phụ thuộc vào câu trả lời ấy.
 *
 * Lại đúng hình dạng đã gặp ba lần trong đợt rà soát này: chú thích mô tả đúng ý định, và mã
 * làm một việc khác.
 *
 * ===== VẾ (b): "ĐANG CHỜ DUYỆT" LÀ NHÁNH `else` — CHƯA PHẢI LỖI, NHƯNG LÀ MÌN =====
 *
 * Nói thẳng, vì sổ rà soát ghi mạnh hơn sự thật: finding viết *"Member bị `denied` và chưa gửi
 * phiếu nào vẫn đọc 'Đang chờ duyệt'"*. Ca đó KHÔNG tới được. `denied` làm `allowed` sai, và
 * panel dừng ở `vault.noPermission` trước khi chạm tới badge.
 *
 * Nhưng cái mà finding nhìn thấy vẫn có thật: badge suy ra bằng phép LOẠI TRỪ, trong khi
 * server gửi hẳn `pending` sang. Hôm nay hai thứ trùng nhau vì
 * `canRequest = grant === null && pending === null` — tức nhánh `else` đúng bằng "có phiếu
 * treo". Ngày nào `break-glass.service.ts` thêm một lý do thứ ba làm `canRequest` sai (trần
 * số phiếu, chủ thể bị đóng băng, người dùng bị khóa), badge sẽ nói dối, im lặng, và không
 * gì đỏ.
 *
 * `VaultPanel` là tài sản dùng chung (`web/src/ui`), nên hợp đồng của nó không được phụ thuộc
 * vào logic nội bộ hiện thời của một service anh em. Badge đọc `pending` là đọc sự thật.
 */
describe('VaultPanel — F-07', () => {
  /** Verdict hỏng, mọi thứ khác lành — đúng cảnh "/verdict 500". */
  function mockVerdictDown(rows: SecretMeta[]) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
        return Promise.resolve(jsonResponse(500, { code: 'INTERNAL', message: 'hỏng' }));
      }
      if (method === 'GET' && url.includes('/vault/secrets')) {
        return Promise.resolve(jsonResponse(200, rows));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('(a) /verdict trả 500: Admin VẪN thấy panel và danh sách ngăn', async () => {
    mockVerdictDown([SECRET]);
    renderPanel();

    // Quyền của Admin không đến từ `verdict`, nên một truy vấn hỏng không được cướp mất panel.
    expect(await screen.findByText('admin web')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thử lại/ })).not.toBeInTheDocument();
  });

  it('(a) /verdict trả 500: Member thì VẪN phải thấy lỗi, không rơi thành "không có quyền"', async () => {
    // Vế đối chứng, và nó giữ một bản vá cũ: lỗi tải verdict KHÔNG được rơi xuống thành
    // "bạn không có quyền" — sai vì thiếu quyền và sai vì hỏng là hai câu khác nhau.
    mockVerdictDown([SECRET]);
    renderPanel({ ...ME, role: 'member' });

    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.queryByText('Bạn chưa được cấp quyền')).not.toBeInTheDocument();
  });

  it('(b) có phiếu treo → badge "Đang chờ duyệt" (vế đối chứng: câu ĐÚNG vẫn phải hiện)', async () => {
    mockApi(
      { ...NEEDS_APPROVAL, canRequest: false, pending: { id: 'p1' } },
      [SECRET],
    );
    renderPanel({ ...ME, role: 'member' });

    expect(await screen.findByText('Đang chờ duyệt')).toBeInTheDocument();
  });

  it('(b) KHÔNG phiếu treo mà cũng không xin được → không được nói "Đang chờ duyệt"', async () => {
    // Hình dạng này server hôm nay KHÔNG sinh ra — xem docblock trên. Bài kiểm khoá HỢP ĐỒNG
    // của component dùng chung, để ngày nào server sinh ra nó thì badge không nói dối.
    mockApi({ ...NEEDS_APPROVAL, canReveal: false, canRequest: false, pending: null }, [
      SECRET,
    ]);
    renderPanel({ ...ME, role: 'member' });

    await screen.findByText('admin web');
    expect(screen.queryByText('Đang chờ duyệt')).not.toBeInTheDocument();
  });
});

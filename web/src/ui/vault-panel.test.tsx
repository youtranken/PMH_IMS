import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { VaultPanel, type AccessVerdict, type SecretMeta } from '@/ui/vault-panel';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * BA HỘP CỦA KÉT SẮT PHẢI KHÓA LẠI KHI LƯỢT GHI ĐANG BAY.
 *
 * ===== CẢNH THẬT =====
 *
 * Gõ mật khẩu mới → bấm Đổi mật khẩu → gõ mã 6 số → trong lúc `rotate.mutateAsync` còn đang bay, bấm
 * Esc / click nền / bấm Hủy. Hộp biến mất; POST vẫn hoàn tất; secret ĐÃ bị xoay thật. Nhưng
 * `onSaved()` không bao giờ chạy: không toast, không refresh danh sách. Người vận hành tin là
 * mình vừa hủy, và giá trị cũ — thứ họ đang dán vào cấu hình thiết bị — đã không còn đúng nữa.
 *
 * Đây đúng là lớp lỗi mà `dismissible={!busy}` có mặt để chặn. Ba hộp của két sắt dùng
 * `mutateAsync` + `stepUp.run`, tức đúng ba hộp có cửa sổ "đang bay" dài nhất.
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
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
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
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <VaultPanel ownerType="device" ownerId="d1" me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
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

describe('VaultPanel — hộp Cất mật khẩu/khóa khóa lại khi đang ghi', () => {
  it('đang cất: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(WHITELIST, []);
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Cất mật khẩu/khóa' }));
    await userEvent.type(screen.getByLabelText(/Tên gọi/), 'admin web');
    await userEvent.type(screen.getByLabelText(/Giá trị/), 'Sup3r#Secret');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    // Lượt POST đang bay: nút Lưu đã đổi sang "Đang lưu…".
    await screen.findByRole('button', { name: 'Đang lưu…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeInTheDocument();
  });
});

describe('VaultPanel — hộp Đổi mật khẩu khóa lại khi đang ghi', () => {
  it('đang xoay: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(WHITELIST, [SECRET]);
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Thao tác với admin web' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đổi mật khẩu' }));
    await userEvent.type(screen.getByLabelText(/Giá trị mới/), 'N3w#Secret');
    await userEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));

    await screen.findByRole('button', { name: 'Đang xử lý…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeInTheDocument();
  });
});

/*
 * Q-20: chữ "Đổi …" nói đúng thứ đang đổi theo loại ngăn — "Đổi giá trị" chung chung làm người
 * dùng phải đoán. Cùng một chữ ở menu, tiêu đề hộp và nút lưu.
 */
describe('VaultPanel — chữ đổi giá trị theo loại ngăn', () => {
  it.each([
    ['password', 'Đổi mật khẩu'],
    ['license_key', 'Đổi license key'],
    ['totp', 'Đổi mã 2 lớp'],
    ['other', 'Đổi giá trị'],
  ] as const)('ngăn %s: menu, tiêu đề hộp và nút lưu ghi "%s"', async (kind, label) => {
    mockApi(WHITELIST, [{ ...SECRET, kind }]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Thao tác với admin web' }));
    await userEvent.click(screen.getByRole('menuitem', { name: label }));
    const dialog = screen.getByRole('dialog', { name: `${label} — admin web` });
    expect(within(dialog).getByRole('button', { name: label })).toBeInTheDocument();
  });
});

describe('VaultPanel — hộp Xin quyền xem khóa lại khi đang gửi', () => {
  it('đang gửi yêu cầu: nút Hủy mờ đi VÀ không đóng được hộp', async () => {
    mockApi(NEEDS_APPROVAL, [SECRET]);
    renderPanel({ ...ME, role: 'member' });

    await userEvent.click(await screen.findByRole('button', { name: 'Xin mở két' }));
    await userEvent.type(
      screen.getByLabelText(/Lý do/),
      'switch tầng 3 mất kết nối',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));

    await screen.findByRole('button', { name: 'Đang xử lý…' });

    expect(cancelButton()).toBeDisabled();
    await userEvent.click(cancelButton());
    expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeInTheDocument();
  });
});

/**
 * HAI VẾ CỦA CÙNG MỘT PANEL.
 *
 * ===== VẾ (a): ADMIN KHÔNG ĐƯỢC BỊ CHẶN BỞI MỘT TRUY VẤN HỌ KHÔNG CẦN =====
 *
 * `useOwnerSecrets` tính `allowed = isAdmin || …`: SA/Admin không chờ `verdict`. Nếu phần
 * render đặt `if (verdict.isLoading)` và `if (verdict.isError)` LÊN TRƯỚC mọi thứ thì
 * `/vault/secrets/verdict` trả 500 là SA/Admin mất sạch panel Két sắt dù quyền của họ không
 * hề phụ thuộc vào câu trả lời ấy.
 *
 * ===== VẾ (b): "ĐANG CHỜ DUYỆT" KHÔNG ĐƯỢC LÀ NHÁNH `else` =====
 *
 * Ca "Member bị `denied` và chưa gửi phiếu nào vẫn đọc 'Đang chờ duyệt'" KHÔNG tới được:
 * `denied` làm `allowed` sai, và panel dừng ở `vault.noPermission` trước khi chạm tới badge.
 *
 * Nhưng suy badge bằng phép LOẠI TRỪ là mìn, trong khi server gửi hẳn `pending` sang. Hôm
 * nay hai thứ trùng nhau vì
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

/**
 * Người xin sau khi bấm Gửi (VLT-006, VLT-007).
 *
 * POST /vault/break-glass trả về PHIẾU (số giờ nằm ở `payload.hours`), không có `hours` ở gốc.
 * Đọc nhầm chỗ thì mọi lần gửi đều hiện cảnh báo "vượt trần… chỉ còn  giờ" với chỗ trống — người
 * xin tin mình bị cắt giờ.
 */
describe('VaultPanel — gửi và rút yêu cầu xem', () => {
  function mockFlow(verdict: AccessVerdict, grantedHours: number) {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
        return Promise.resolve(jsonResponse(200, verdict));
      }
      if (method === 'GET' && url.includes('/vault/secrets')) {
        return Promise.resolve(jsonResponse(200, [SECRET]));
      }
      if (method === 'POST' && url.endsWith('/vault/break-glass')) {
        return Promise.resolve(
          jsonResponse(201, { id: 'p1', state: 'pending', payload: { hours: grantedHours } }),
        );
      }
      if (method === 'POST' && url.includes('/cancel')) {
        return Promise.resolve(jsonResponse(201, { id: 'p1', state: 'cancelled' }));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  async function send(hours: string) {
    await userEvent.click(await screen.findByRole('button', { name: 'Xin mở két' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Lý do/), 'switch tầng 3 mất kết nối');
    const hoursBox = within(dialog).getByLabelText(/Xin trong bao lâu/);
    await userEvent.clear(hoursBox);
    await userEvent.type(hoursBox, hours);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu' }));
  }

  it('gửi 4 giờ, được 4 giờ → báo "Đã gửi", không cảnh báo vượt trần', async () => {
    mockFlow(NEEDS_APPROVAL, 4);
    renderPanel({ ...ME, role: 'member' });
    await send('4');
    expect(await screen.findByText(/Đã gửi yêu cầu. Quản trị/)).toBeInTheDocument();
    expect(screen.queryByText(/vượt mức tối đa/)).not.toBeInTheDocument();
  });

  it('gửi 72 giờ, trần 24 → cảnh báo có ĐÚNG con số 24', async () => {
    mockFlow(NEEDS_APPROVAL, 24);
    renderPanel({ ...ME, role: 'member' });
    await send('72');
    expect(await screen.findByText(/chỉ còn 24 giờ khi được duyệt/)).toBeInTheDocument();
  });

  it('đang có phiếu treo → rút được, qua hộp xác nhận', async () => {
    const calls = mockFlow(
      {
        ...NEEDS_APPROVAL,
        canRequest: false,
        pending: { id: 'p1', createdAt: '2026-09-20T01:30:00.000Z' },
        pendingExpireHours: 8,
      },
      4,
    );
    renderPanel({ ...ME, role: 'member' });
    // Q-15: yêu cầu chờ không gắn phiên — người xin được bảo cứ đóng trang, chờ thư.
    expect(await screen.findByText(/Bạn có thể đóng trang/)).toBeInTheDocument();
    expect(screen.getByText(/trong 8 giờ thì yêu cầu tự hết hạn/)).toBeInTheDocument();
    expect(screen.queryByText(/Giữ trang này mở/)).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Rút yêu cầu' }));
    // Chưa xác nhận thì CHƯA gọi API.
    expect(calls.some((c) => c.url.includes('/cancel'))).toBe(false);
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Rút yêu cầu' }));

    expect(await screen.findByText('Đã rút yêu cầu.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/break-glass/p1/cancel'))).toBe(
      true,
    );
  });

  it('MỘT nút xin cho cả két (quyền cấp theo hồ sơ), từng dòng chỉ nói "Cần duyệt"', async () => {
    mockApi(NEEDS_APPROVAL, [SECRET, { ...SECRET, id: 's2', label: 'SSH root' }]);
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findAllByText('Cần duyệt')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Xin mở két' })).toHaveLength(1);
    expect(screen.getByText(/cần được duyệt trước khi xem \(2 ngăn\)/)).toBeInTheDocument();
  });

  it('lần xin gần nhất bị từ chối → nói ra cùng ghi chú của người duyệt, ngay trên nút xin', async () => {
    mockApi(
      {
        ...NEEDS_APPROVAL,
        lastDenied: { at: '2026-09-20T01:30:00.000Z', note: 'Lý do chưa đủ cụ thể' },
      },
      [SECRET],
    );
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText(/Lần xin lúc 20\/09\/2026 08:30 bị từ chối/)).toBeInTheDocument();
    expect(screen.getByText('Lý do chưa đủ cụ thể')).toBeInTheDocument();
  });

  it('nấc giờ trong trần server đưa; chạm "2 giờ" là gửi 2', async () => {
    const calls = mockFlow({ ...NEEDS_APPROVAL, maxGrantHours: 6 }, 2);
    renderPanel({ ...ME, role: 'member' });
    await userEvent.click(await screen.findByRole('button', { name: 'Xin mở két' }));
    const dialog = screen.getByRole('dialog', { name: 'Xin mở két (1 ngăn)' });
    const group = within(dialog).getByRole('group', { name: 'Chọn nhanh số giờ' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1 giờ',
      '2 giờ',
      '4 giờ',
      '6 giờ',
    ]);
    expect(within(dialog).getByText(/tối đa 6 giờ/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Lý do/), 'switch tầng 3 mất kết nối');
    expect(within(dialog).getByText('Đã gõ 25 ký tự · tối thiểu 5.')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: '2 giờ' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu' }));
    const sent = calls.find((c) => c.method === 'POST' && c.url.endsWith('/vault/break-glass'));
    expect(JSON.parse(sent!.body!)).toMatchObject({ hours: 2 });
  });
});

describe('VaultPanel — ô giá trị, tuổi giá trị, xoá vĩnh viễn', () => {
  it('ô Giá trị che mặc định; "Hiện" để xem lại; "Tạo ngẫu nhiên" điền giá trị mạnh và hiện ra', async () => {
    mockApi(WHITELIST, [SECRET]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Cất mật khẩu/khóa' }));
    const dialog = screen.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
    const value = within(dialog).getByLabelText(/^Giá trị/);
    expect(value).toHaveAttribute('type', 'password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hiện' }));
    expect(value).toHaveAttribute('type', 'text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ẩn' }));
    expect(value).toHaveAttribute('type', 'password');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Tạo ngẫu nhiên' }));
    expect((value as HTMLInputElement).value).toHaveLength(20);
    expect(value).toHaveAttribute('type', 'text');
    expect(within(dialog).queryByTestId('secret-strength-warning')).not.toBeInTheDocument();
  });

  it('cột "Đổi lần cuối": ngày đổi + đếm ngược, quá hạn thì "Quá N ngày — cần đổi"; ai đổi', async () => {
    mockApi(WHITELIST, [
      {
        ...SECRET,
        valueChangedAt: '2025-08-15T03:00:00.000Z',
        valueChangedBy: 'it01@pmh.com.vn',
        valueAgeDays: 400,
        valueStale: true,
        dueInDays: -220,
      },
      { ...SECRET, id: 's2', label: 'SSH root', valueChangedAt: '2026-09-01T03:00:00.000Z', dueInDays: 152 },
    ]);
    renderPanel();
    expect(await screen.findByRole('columnheader', { name: 'Đổi lần cuối' })).toBeInTheDocument();
    expect(screen.getByText('Quá 220 ngày — cần đổi')).toHaveClass('badge', 'warn');
    expect(screen.getByText('15/08/2025')).toBeInTheDocument();
    expect(screen.getByText('còn 152 ngày')).toBeInTheDocument();
    expect(screen.getByText('Người đổi: it01@pmh.com.vn')).toBeInTheDocument();
  });

  it('hộp Đổi license key luôn nhắc: IMS không nối tới máy chủ/thiết bị — đổi trên hệ thống thật trước', async () => {
    mockApi(WHITELIST, [{ ...SECRET, kind: 'license_key' }]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Thao tác với admin web' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đổi license key' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/IMS không đổi gì trên thiết bị thật/)).toBeInTheDocument();
    // Chỉ cảnh báo — không có ô tick nào phải bấm trước khi lưu.
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('Xoá vĩnh viễn: nút xác nhận chỉ bật khi gõ lại ĐÚNG tên ngăn; chưa gõ thì không gọi API', async () => {
    const fetchMock = mockApi(WHITELIST, [SECRET]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Thao tác với admin web' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Xóa vĩnh viễn' }));
    const confirm = await screen.findByRole('dialog');
    const button = within(confirm).getByRole('button', { name: 'Xóa vĩnh viễn' });
    expect(button).toBeDisabled();
    await userEvent.type(within(confirm).getByRole('textbox'), 'admin web');
    expect(button).toBeEnabled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});

/**
 * Q-15 — quyền mở két gắn với phiên đăng nhập đã xin; người xin tự trả quyền sớm (VLT-055).
 *
 * Người xin phải ĐỌC được rằng đăng xuất là mất quyền (không thì đăng nhập lại và tưởng hệ
 * thống hỏng), và đóng được két khi xong việc mà không phải nhờ người duyệt thu hồi.
 */
describe('VaultPanel — quyền theo phiên và nút Trả quyền', () => {
  const GRANTED: AccessVerdict = {
    ...NEEDS_APPROVAL,
    canReveal: true,
    canRequest: false,
    grant: { id: 'g1', expiresAt: '2026-09-20T05:30:00.000Z' },
    grantSecondsLeft: 3600,
  };

  function mockRelease(verdict: AccessVerdict) {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
          return Promise.resolve(jsonResponse(200, verdict));
        }
        if (method === 'GET' && url.includes('/vault/secrets')) {
          return Promise.resolve(jsonResponse(200, [SECRET]));
        }
        if (method === 'POST' && url.includes('/release')) {
          return Promise.resolve(jsonResponse(201, { id: 'g1', state: 'revoked' }));
        }
        return new Promise<Response>(() => {});
      }),
    );
    return calls;
  }

  it('đang có quyền: thấy đếm lùi, câu "hết khi đăng xuất" và nút Trả quyền', async () => {
    mockRelease(GRANTED);
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText(/Bạn được xem tới/)).toBeInTheDocument();
    expect(screen.getByText(/đăng xuất hay hết phiên/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trả quyền' })).toBeInTheDocument();
  });

  it('Trả quyền đi qua hộp xác nhận, rồi gọi đúng phiếu', async () => {
    const calls = mockRelease(GRANTED);
    renderPanel({ ...ME, role: 'member' });
    await userEvent.click(await screen.findByRole('button', { name: 'Trả quyền' }));
    // Chưa xác nhận thì CHƯA gọi API.
    expect(calls.some((c) => c.url.includes('/release'))).toBe(false);
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Trả quyền' }));

    expect(await screen.findByText(/Đã trả quyền/)).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === 'POST' && c.url.includes('/vault/break-glass/g1/release')),
    ).toBe(true);
  });

  it('bấm Hủy ở hộp xác nhận thì không trả gì', async () => {
    const calls = mockRelease(GRANTED);
    renderPanel({ ...ME, role: 'member' });
    await userEvent.click(await screen.findByRole('button', { name: 'Trả quyền' }));
    const confirm = await screen.findByRole('dialog');
    // Nút ✕ và nút cuối hộp cùng tên "Hủy" — bấm nút cuối hộp.
    const buttons = within(confirm).getAllByRole('button', { name: 'Hủy' });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('button', { name: 'Trả quyền' })).toBeEnabled();
    expect(calls.some((c) => c.url.includes('/release'))).toBe(false);
  });

  it('không có quyền đang chạy thì không có nút Trả quyền', async () => {
    mockRelease(NEEDS_APPROVAL);
    renderPanel({ ...ME, role: 'member' });
    await screen.findByRole('button', { name: 'Xin mở két' });
    expect(screen.queryByRole('button', { name: 'Trả quyền' })).not.toBeInTheDocument();
  });

  it('quyền đã gắn ở phiên khác: nói rõ vì sao phải xin lại', async () => {
    mockRelease({ ...NEEDS_APPROVAL, otherSessionHeld: true });
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText(/đang gắn với một phiên đăng nhập khác/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xin mở két' })).toBeInTheDocument();
  });

  it('đã duyệt, chưa xem lần nào: chỉ đường "bấm Xem, nhập mã 6 số", có nút Xem ở ngăn', async () => {
    mockRelease({
      ...NEEDS_APPROVAL,
      canReveal: true,
      canRequest: false,
      claimable: { id: 'g1', expiresAt: '2026-09-20T05:30:00.000Z' },
      grantSecondsLeft: 3600,
    });
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText(/Đã được duyệt — bấm "Xem"/)).toBeInTheDocument();
    expect(screen.getByText(/tính từ lúc duyệt/)).toBeInTheDocument();
    expect(screen.getByText(/Lần xem đầu gắn quyền vào phiên/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Xem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xin mở két' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nhận quyền/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trả quyền' })).toBeInTheDocument();
  });

  /* SEC-20 + Q-15: ghi chú ngăn chỉ về khi grant đã gắn phiên này — lần Xem đầu gắn nó, nên
     danh sách phải tải lại để ghi chú hiện ra, không đợi người dùng F5. */
  it('lần Xem đầu (gắn quyền vào phiên): tải lại danh sách ngăn để ghi chú hiện ra', async () => {
    const calls = mockRelease({
      ...NEEDS_APPROVAL,
      canReveal: true,
      canRequest: false,
      claimable: { id: 'g1', expiresAt: '2026-09-20T05:30:00.000Z' },
      grantSecondsLeft: 3600,
    });
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST' && String(input).includes('/reveal')) {
        calls.push({ url: String(input), method: 'POST' });
        return Promise.resolve(
          jsonResponse(200, { value: 'Sup3r#Secret', revealSeconds: 60, stepUpSecondsLeft: 600 }),
        );
      }
      return base(input, init);
    });
    renderPanel({ ...ME, role: 'member' });
    const listLoads = () =>
      calls.filter((c) => c.method === 'GET' && /\/vault\/secrets\?/.test(c.url)).length;
    await userEvent.click(await screen.findByRole('button', { name: 'Xem' }));
    expect(await screen.findByTestId('secret-value')).toHaveTextContent('Sup3r#Secret');
    const before = listLoads();
    await vi.waitFor(() => expect(listLoads()).toBeGreaterThan(1));
    expect(before).toBeGreaterThanOrEqual(1);
  });

  it('hộp xin nói trước: lần xem đầu gắn quyền vào phiên, đăng xuất hay hết phiên là hết', async () => {
    mockRelease(NEEDS_APPROVAL);
    renderPanel({ ...ME, role: 'member' });
    await userEvent.click(await screen.findByRole('button', { name: 'Xin mở két' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/bấm "Xem" lần đầu/)).toBeInTheDocument();
    expect(within(dialog).getByText(/đăng xuất hay hết phiên/)).toBeInTheDocument();
  });
});

/**
 * VLT-062 — khung két nằm TRONG một hộp (popup trang Két tổng): bước gõ mã và bước hiện giá
 * trị chạy ngay trong hộp đó. Chồng thêm hai hộp là ba lớp trên điện thoại.
 */
describe('VaultPanel — xem giá trị theo bước trong cùng hộp (VLT-062)', () => {
  function mockReveal() {
    const calls: { url: string; method: string }[] = [];
    let steppedUp = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
          return Promise.resolve(jsonResponse(200, WHITELIST));
        }
        if (method === 'GET' && url.includes('/vault/secrets')) {
          return Promise.resolve(jsonResponse(200, [SECRET]));
        }
        if (method === 'POST' && url.includes('/auth/step-up')) {
          steppedUp = true;
          return Promise.resolve(jsonResponse(200, { graceMinutes: 10 }));
        }
        if (method === 'POST' && url.includes('/reveal')) {
          return Promise.resolve(
            steppedUp
              ? jsonResponse(200, { value: 'Sup3r#Secret', revealSeconds: 60, stepUpSecondsLeft: 600 })
              : jsonResponse(403, { code: 'STEPUP_REQUIRED', message: 'Cần xác nhận' }),
          );
        }
        return new Promise<Response>(() => {});
      }),
    );
    return calls;
  }

  function renderInline() {
    return renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <VaultPanel ownerType="device" ownerId="d1" me={ME} stepsInline />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('Xem → bước mã → bước giá trị, KHÔNG mở hộp nào; Ẩn ngay thì về danh sách', async () => {
    const calls = mockReveal();
    renderInline();
    await userEvent.click(await screen.findByRole('button', { name: 'Xem' }));

    const step = await screen.findByRole('region', { name: 'Xác nhận danh tính' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Danh sách ngăn nhường chỗ cho bước — không còn nút Xem nào sau lưng.
    expect(screen.queryByRole('button', { name: 'Xem' })).not.toBeInTheDocument();

    await userEvent.type(within(step).getByLabelText('Mã xác thực'), '123456');
    expect(await screen.findByTestId('secret-value')).toHaveTextContent('Sup3r#Secret');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/auth/step-up'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Ẩn ngay' }));
    expect(screen.queryByTestId('secret-value')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Xem' })).toBeInTheDocument();
  });

  it('bước mã có nút Quay lại về danh sách, không gửi gì', async () => {
    const calls = mockReveal();
    renderInline();
    await userEvent.click(await screen.findByRole('button', { name: 'Xem' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('button', { name: 'Xem' })).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/auth/step-up'))).toBe(false);
  });

  it('không có hộp bao ngoài (trang hồ sơ): vẫn là hộp riêng như cũ', async () => {
    mockReveal();
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Xem' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('VaultPanel — ngoài danh sách (VLT-056)', () => {
  it('không có quyền: nói rõ và chỉ đường liên hệ người gán quyền', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/vault/secrets/verdict')) {
        return Promise.resolve(
          jsonResponse(200, { ...NEEDS_APPROVAL, tier: 'denied', canRequest: false }),
        );
      }
      if (url.includes('/auth/support-contact')) {
        return Promise.resolve(jsonResponse(200, { contact: 'Anh Tùng IT — 0909 000 111' }));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText('Bạn chưa có quyền xem két này')).toBeInTheDocument();
    expect(await screen.findByText(/Anh Tùng IT — 0909 000 111/)).toBeInTheDocument();
  });
});

describe('VaultPanel — thanh công cụ, tiêu đề hộp, câu rỗng (DEV-035 · DEV-057 · DEV-079)', () => {
  function renderWith(props: { canEdit?: boolean; locked?: boolean }) {
    mockApi(WHITELIST, []);
    return renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <VaultPanel
              ownerType="device"
              ownerId="d1"
              me={ME}
              ownerLabel="SW-CORE-01"
              canEdit={props.canEdit}
              locked={props.locked}
            />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('tiêu đề khu + số ngăn + nút cất cùng một thanh; hộp cất nêu tên máy', async () => {
    renderWith({});
    expect(await screen.findByRole('heading', { name: 'Ngăn két' })).toBeInTheDocument();
    expect(await screen.findByText('Két chưa có ngăn nào')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cất mật khẩu/khóa' }));
    expect(
      await screen.findByRole('dialog', { name: 'Cất mật khẩu/khóa — SW-CORE-01' }),
    ).toBeInTheDocument();
  });

  it('hồ sơ đã khóa: không nút cất, câu rỗng nói đã khóa thay vì mời "cất vào đây"', async () => {
    renderWith({ canEdit: false, locked: true });
    expect(await screen.findByText('Két chưa có ngăn nào')).toBeInTheDocument();
    expect(screen.getByText(/Hồ sơ đã khóa/)).toBeInTheDocument();
    expect(screen.queryByText(/cất vào đây/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cất mật khẩu/khóa' })).toBeNull();
  });

  /*
   * Người chỉ được xem (Thành viên có grant) vẫn thấy ngăn và nút Xem, nhưng KHÔNG có nút mở
   * menu Sửa · Xoay · Thu hồi — bày ra là hứa một việc API sẽ trả 403.
   */
  it('canEdit=false có ngăn: còn nút Xem, không có menu ghi của ngăn', async () => {
    mockApi(WHITELIST, [SECRET]);
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <VaultPanel ownerType="device" ownerId="d1" me={ME} canEdit={false} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Xem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Thao tác với/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cất mật khẩu/khóa' })).toBeNull();
  });
});

/**
 * Q-18 / FR-035: ghi chú của ngăn két không được chứa mật khẩu. Server chặn; form chặn TRƯỚC
 * khi gửi để người dùng không phải qua mã 6 số rồi mới biết là hỏng.
 */
describe('VaultPanel — ghi chú không được chứa mật khẩu', () => {
  function writes(fetchMock: ReturnType<typeof mockApi>) {
    return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');
  }

  async function openCreate() {
    await userEvent.click(await screen.findByRole('button', { name: 'Cất mật khẩu/khóa' }));
    const dialog = screen.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
    await userEvent.type(within(dialog).getByLabelText(/Tên gọi/), 'admin web');
    await userEvent.type(within(dialog).getByLabelText(/^Giá trị/), 'Sup3r#Secret');
    return dialog;
  }

  it('ghi chú chứa chính giá trị: báo ngay tại ô, bấm Lưu không gửi gì', async () => {
    const fetchMock = mockApi(WHITELIST, []);
    renderPanel();
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/Ghi chú/), 'mk là sup3r#secret');
    expect(within(dialog).getByText(/Ghi chú đang chứa chính giá trị/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('ghi chú có chuỗi trông như mật khẩu: báo ngay tại ô, bấm Lưu không gửi gì', async () => {
    const fetchMock = mockApi(WHITELIST, []);
    renderPanel();
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText(/Ghi chú/), 'mk cũ Admin@123456');
    expect(within(dialog).getByText(/trông như mật khẩu/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it('ghi chú bình thường: gửi đi như cũ', async () => {
    const fetchMock = mockApi(WHITELIST, []);
    renderPanel();
    const dialog = await openCreate();
    await userEvent.type(
      within(dialog).getByLabelText(/Ghi chú/),
      'Model FortiGate 60F, IP quản trị 10.0.0.1',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await screen.findByRole('button', { name: 'Đang lưu…' });
    expect(writes(fetchMock)).toHaveLength(1);
  });

  it('Đổi mật khẩu: giá trị mới nằm trong ghi chú đang có thì không gửi', async () => {
    const fetchMock = mockApi(WHITELIST, [{ ...SECRET, note: 'mo cong 8443 truoc' }]);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Thao tác với admin web' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đổi mật khẩu' }));
    await userEvent.type(screen.getByLabelText(/Giá trị mới/), 'mocong8443');
    await userEvent.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(screen.getByText(/Giá trị mới đang nằm trong ghi chú/)).toBeInTheDocument();
    expect(writes(fetchMock)).toHaveLength(0);
  });
});

/**
 * SEC-20: ghi chú không in sẵn dưới tên ngăn (người đứng sau lưng đọc được, và đó là thứ server
 * chỉ gửi cho người mở được ngăn). Bấm "Ghi chú" mới hiện.
 */
describe('VaultPanel — ghi chú của ngăn hiện khi bấm, không in sẵn', () => {
  const NOTE = 'Gọi NOC trước khi reboot';

  it('có ghi chú: dòng không in chữ, bấm "Ghi chú" mới hiện, bấm lại thì ẩn', async () => {
    mockApi(WHITELIST, [{ ...SECRET, note: NOTE, hasNote: true }]);
    renderPanel();
    const toggle = await screen.findByRole('button', { name: 'Ghi chú' });
    // Chữ + mũi tên: thiếu `with-icon` thì mũi tên nằm theo đường cơ sở, lệch khỏi tâm nút.
    expect(toggle).toHaveClass('with-icon');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(NOTE)).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(NOTE)).toBeVisible();
    await userEvent.click(toggle);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('server giấu ghi chú (chưa mở được ngăn): nói là có, không nút, không chữ', async () => {
    mockApi(NEEDS_APPROVAL, [{ ...SECRET, note: null, hasNote: true }]);
    renderPanel({ ...ME, role: 'member' });
    expect(await screen.findByText(/Có ghi chú — hiện khi bạn mở được ngăn này/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ghi chú' })).toBeNull();
  });

  it('không có ghi chú: không nút, không câu nào', async () => {
    mockApi(WHITELIST, [{ ...SECRET, note: null, hasNote: false }]);
    renderPanel();
    expect(await screen.findByText('admin web')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ghi chú' })).toBeNull();
    expect(screen.queryByText(/Có ghi chú/)).toBeNull();
  });
});

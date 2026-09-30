import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { VaultPanel, type AccessVerdict, type SecretMeta } from '@/ui/vault-panel';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

// Mỗi bài gõ đủ một form két (tên, loại, giá trị) qua userEvent — quá 5 giây mặc định khi máy bận.
vi.setConfig({ testTimeout: 20_000 });

const decodeQrFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/qr-decode', () => ({ decodeQrFile }));

/**
 * Ngăn "Mã 2 lớp" trên panel két (Q-18): chọn loại, dán khóa hoặc đọc từ ảnh QR (ảnh không gửi
 * lên), và một lần gõ mã 6 số dùng cho mọi thao tác két trong grace.
 */

const ME: Me = {
  id: 'u1',
  email: 'admin@pmh.com.vn',
  fullName: 'Quản trị',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  // Client KHÔNG biết mốc step-up — đúng như thật: `me` không mang nó sau lượt gõ mã.
  steppedUpAt: null,
  csrfToken: 'csrf-1',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 60 },
};

const WHITELIST: AccessVerdict = {
  tier: 'whitelist',
  tierLabel: 'Được xem thẳng',
  canReveal: true,
  canRequest: false,
  grant: null,
  pending: null,
};

const TOTP_ROW: SecretMeta = {
  id: 't1',
  ownerType: 'device',
  ownerId: 'd1',
  kind: 'totp',
  label: 'VPN FortiGate',
  username: 'admin',
  note: null,
  createdBy: 'u1',
  createdAt: '2026-09-01T03:00:00.000Z',
  updatedAt: '2026-09-01T03:00:00.000Z',
};

type Call = { url: string; method: string; body: unknown };

/** Server "còn trong grace": mọi lượt ghi trả 201 ngay, không bao giờ STEPUP_REQUIRED. */
function mockApi(rows: SecretMeta[], reveal?: unknown) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET' && url.includes('/vault/secrets/verdict')) {
      return Promise.resolve(jsonResponse(200, WHITELIST));
    }
    if (method === 'GET' && url.includes('/vault/secrets')) {
      return Promise.resolve(jsonResponse(200, rows));
    }
    if (url.endsWith('/reveal')) return Promise.resolve(jsonResponse(200, reveal));
    return Promise.resolve(jsonResponse(201, { id: 'new' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderPanel() {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <VaultPanel ownerType="device" ownerId="d1" me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET');

async function openCreate(kind: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Cất mật khẩu/khóa' }));
  const dialog = screen.getByRole('dialog', { name: 'Cất mật khẩu/khóa' });
  await userEvent.type(within(dialog).getByLabelText(/Tên gọi/), `E2E ${kind}`);
  if (kind !== 'Mật khẩu') {
    await userEvent.click(within(dialog).getByRole('button', { name: 'Loại' }));
    await userEvent.click(screen.getByRole('option', { name: kind }));
  }
  return dialog;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  decodeQrFile.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VaultPanel — cất ngăn Mã 2 lớp', () => {
  it('loại "Mã 2 lớp" có trong ô chọn; ô giá trị che, không có "Tạo ngẫu nhiên"', async () => {
    mockApi([]);
    renderPanel();
    const dialog = await openCreate('Mã 2 lớp');
    const value = within(dialog).getByLabelText(/^Giá trị/);
    expect(value).toHaveAttribute('type', 'password');
    expect(within(dialog).queryByRole('button', { name: 'Tạo ngẫu nhiên' })).toBeNull();
    expect(within(dialog).getByText(/otpauth:\/\//)).toBeInTheDocument();
  });

  it('đọc từ ảnh QR: điền ô giá trị, ảnh KHÔNG đi lên server, lượt ghi mang chuỗi đọc được', async () => {
    const calls = mockApi([]);
    const uri = 'otpauth://totp/VPN:admin?secret=JBSWY3DPEHPK3PXP&issuer=VPN';
    decodeQrFile.mockResolvedValue({ value: uri, reason: null });
    renderPanel();
    const dialog = await openCreate('Mã 2 lớp');

    const image = new File([new Uint8Array([137, 80, 78, 71])], 'qr.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText('Đọc từ ảnh QR'), image);

    expect(decodeQrFile).toHaveBeenCalledWith(image);
    expect(within(dialog).getByLabelText(/^Giá trị/)).toHaveValue(uri);
    expect(await within(dialog).findByText('Đã đọc mã QR.')).toBeInTheDocument();
    // Chọn ảnh không sinh ra lượt gọi mạng nào.
    expect(writes(calls)).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await screen.findByText('Đã lưu vào két.');
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0].body).toMatchObject({ kind: 'totp', value: uri });
    expect(JSON.stringify(writes(calls)[0].body)).not.toContain('qr.png');
  });

  it('ảnh không có QR: báo lỗi tại chỗ, ô giá trị để nguyên', async () => {
    mockApi([]);
    decodeQrFile.mockResolvedValue({ value: null, reason: 'NO_QR' });
    renderPanel();
    const dialog = await openCreate('Mã 2 lớp');
    const image = new File([new Uint8Array([1])], 'anh.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText('Đọc từ ảnh QR'), image);
    expect(await within(dialog).findByText(/Không tìm thấy mã QR/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Giá trị/)).toHaveValue('');
  });
});

/**
 * Q-18: MỘT lần gõ mã cho mọi thao tác két trong `secret.stepup_grace_minutes`. Client không tự
 * đoán grace (không biết `stepped_up_at`), nên khi server nói còn grace thì KHÔNG được hỏi mã.
 */
describe('VaultPanel — không hỏi mã trước khi server đòi', () => {
  it('cất mật khẩu rồi cất mã 2 lớp: không hộp "Xác nhận danh tính" nào, đúng hai lượt ghi', async () => {
    const calls = mockApi([]);
    renderPanel();

    let dialog = await openCreate('Mật khẩu');
    await userEvent.type(within(dialog).getByLabelText(/^Giá trị/), 'Sup3r#Secret');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await screen.findByText('Đã lưu vào két.');
    expect(screen.queryByRole('heading', { name: 'Xác nhận danh tính' })).toBeNull();

    dialog = await openCreate('Mã 2 lớp');
    await userEvent.type(within(dialog).getByLabelText(/^Giá trị/), 'JBSWY3DPEHPK3PXP');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await screen.findAllByText('Đã lưu vào két.');
    expect(screen.queryByRole('heading', { name: 'Xác nhận danh tính' })).toBeNull();

    expect(writes(calls).map((call) => (call.body as { kind: string }).kind)).toEqual([
      'password',
      'totp',
    ]);
  });
});

describe('VaultPanel — mở ngăn Mã 2 lớp', () => {
  it('Xem → hộp hiện QR + mã từ phản hồi server', async () => {
    mockApi([TOTP_ROW], {
      value: 'otpauth://totp/VPN:admin?secret=JBSWY3DPEHPK3PXP',
      revealSeconds: 60,
      stepUpSecondsLeft: 540,
      totp: {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'VPN',
        account: 'admin',
        digits: 6,
        period: 30,
        qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        codes: ['123456'],
        secondsLeft: 20,
      },
    });
    renderPanel();
    expect(await screen.findByText('Mã 2 lớp')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xem' }));
    expect(await screen.findByRole('img', { name: /Mã QR/ })).toBeInTheDocument();
    expect(screen.getByTestId('totp-code')).toHaveTextContent('123 456');
  });
});

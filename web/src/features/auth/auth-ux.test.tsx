import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { AuthCard } from './auth-card';
import { SupportHelp } from './support-help';
import { TotpSetup } from './totp-setup';
import type { Me } from '@/lib/me';

function withProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login/2fa']}>
        <Routes>
          <Route path="/login/2fa" element={ui} />
          <Route path="/login" element={<p>Màn đăng nhập</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubNarrow(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  qrDataUrl: 'data:image/png,x',
  otpauthUrl: 'otpauth://totp/IMS%20PMH:a%40pmh.com.vn?secret=JBSWY3DPEHPK3PXP&issuer=IMS%20PMH',
};

describe('AUTH-011: cài 2 lớp trên chính điện thoại', () => {
  it('màn hẹp: nút mở ứng dụng + chép khoá đứng đầu, QR thu vào "Quét từ máy khác"', () => {
    stubNarrow(true);
    withProviders(<TotpSetup data={SETUP} />);
    expect(screen.getByRole('link', { name: 'Mở trong ứng dụng xác thực' })).toHaveAttribute(
      'href',
      SETUP.otpauthUrl,
    );
    expect(screen.getByRole('button', { name: 'Sao chép khóa' })).toBeInTheDocument();
    expect(screen.getByTestId('totp-secret')).toHaveTextContent(SETUP.secret);
    const other = screen.getByText('Quét từ máy khác (mã QR)').closest('details')!;
    expect(other).not.toHaveAttribute('open');
    expect(within(other).getByAltText('Mã QR cài xác thực 2 lớp')).toBeInTheDocument();
  });

  it('desktop: QR là chính, không có link otpauth (máy tính không có ứng dụng xác thực)', () => {
    stubNarrow(false);
    withProviders(<TotpSetup data={SETUP} />);
    const qr = screen.getByAltText('Mã QR cài xác thực 2 lớp');
    expect(qr.closest('details')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mở trong ứng dụng xác thực' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sao chép khóa' })).toBeInTheDocument();
  });
});

describe('AUTH-003 / AUTH-018: chỉ đường khi quên mật khẩu hoặc mất mã', () => {
  it('bấm "Quên mật khẩu?" → hiện hướng dẫn + câu liên hệ đọc từ route công khai', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { contact: 'Gọi anh Tuấn — máy lẻ 123' }));
    vi.stubGlobal('fetch', fetchSpy);
    withProviders(<SupportHelp kind="password" />);
    // Chưa bấm thì chưa hỏi server: người không cần hướng dẫn không tốn một lượt gọi.
    expect(fetchSpy).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Quên mật khẩu?' }));
    expect(await screen.findByText(/Gọi anh Tuấn — máy lẻ 123/)).toBeInTheDocument();
    expect(screen.getByText(/Super Admin sẽ cấp cho bạn một mật khẩu tạm/)).toBeInTheDocument();
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/v1/auth/support-contact');
  });

  it('màn mã 2 lớp: "Không lấy được mã?" nói về đặt lại 2 lớp, không nói về mật khẩu', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { contact: 'x' })));
    withProviders(<SupportHelp kind="totp" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Không lấy được mã?' }));
    expect(await screen.findByText(/đặt lại xác thực 2 lớp cho bạn/)).toBeInTheDocument();
  });
});

describe('AUTH-017: màn giữa luồng cho thấy tài khoản và có lối thoát', () => {
  it('hiện email đang đăng nhập; "Đăng xuất" gọi logout rồi về /login', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'logged-out' }));
    vi.stubGlobal('fetch', fetchSpy);
    withProviders(
      <AuthCard title="Xác thực 2 lớp" signedInAs={{ email: 'nham@pmh.com.vn', csrfToken: 'tok' }}>
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.getByTestId('auth-signed-in-as')).toHaveTextContent('nham@pmh.com.vn');
    expect(screen.getByText(/Không phải nham@pmh.com.vn\?/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
  });

  it('màn đăng nhập (chưa có phiên) thì không có dòng email, không có nút Đăng xuất', () => {
    withProviders(
      <AuthCard title="Đăng nhập">
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.queryByTestId('auth-signed-in-as')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
  });
});

describe('AUTH-026 / AUTH-031: luồng lần đầu nói "bước mấy", card nói tên hệ thống', () => {
  const base = { id: 'u', email: 'moi@pmh.com.vn', csrfToken: 't', totpEnrolled: false } as unknown as Me;

  afterEach(() => sessionStorage.clear());

  it('cài 2 lớp rồi đổi mật khẩu → "Bước 1/2" rồi "Bước 2/2", dù `me` thôi nhắc bước đã xong', () => {
    const first = withProviders(
      <AuthCard title="Cài xác thực 2 lớp" setupFor={{ ...base, totpPending: true, mustChangePassword: true }}>
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.getByTestId('auth-steps')).toHaveTextContent('Bước 1/2 · Cài xác thực 2 lớp');
    first.unmount();
    withProviders(
      <AuthCard title="Đổi mật khẩu" setupFor={{ ...base, totpEnrolled: true, mustChangePassword: true }}>
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.getByTestId('auth-steps')).toHaveTextContent('Bước 2/2 · Đổi mật khẩu tạm');
  });

  it('chỉ một bước (SA vừa đặt lại mật khẩu) → không đánh số', () => {
    withProviders(
      <AuthCard title="Đổi mật khẩu" setupFor={{ ...base, totpEnrolled: true, mustChangePassword: true }}>
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.queryByTestId('auth-steps')).toBeNull();
  });

  it('dưới logo có tên đầy đủ và công ty', () => {
    withProviders(
      <AuthCard title="Đăng nhập">
        <p>thân</p>
      </AuthCard>,
    );
    expect(screen.getByText('Quản lý hệ thống IT · PMH')).toBeInTheDocument();
  });
});

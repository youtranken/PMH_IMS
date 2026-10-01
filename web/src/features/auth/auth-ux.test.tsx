import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('AUTH-018: màn mã 2 lớp chỉ đường khi không lấy được mã (Q-14, Q-18)', () => {
  it('bấm "Không lấy được mã?" → hướng dẫn đặt lại 2 lớp + câu liên hệ đọc từ route công khai', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { contact: 'Gọi anh Tuấn — máy lẻ 123' }));
    vi.stubGlobal('fetch', fetchSpy);
    withProviders(<SupportHelp />);
    // Chưa bấm thì chưa hỏi server: người không cần hướng dẫn không tốn một lượt gọi.
    expect(fetchSpy).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Không lấy được mã?' }));
    expect(await screen.findByText(/Gọi anh Tuấn — máy lẻ 123/)).toBeInTheDocument();
    expect(screen.getByText(/nhờ Super Admin đặt lại xác thực 2 lớp/)).toBeInTheDocument();
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/v1/auth/support-contact');
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
    expect(screen.getByTestId('auth-signed-in-as')).toHaveTextContent('Đang đăng nhập: nham@pmh.com.vn');
    // Email in đậm: đó là thứ người ta cần soát lại, không phải chữ "Đang đăng nhập".
    expect(screen.getByText('nham@pmh.com.vn', { selector: 'strong' })).toBeInTheDocument();
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

  it('có mảng thương hiệu bên cạnh card (desktop): tên công ty và vài dòng về IMS', () => {
    withProviders(
      <AuthCard title="Đăng nhập">
        <p>thân</p>
      </AuthCard>,
    );
    const panel = screen.getByTestId('auth-panel');
    expect(panel).toHaveTextContent('Phú Mỹ Hưng');
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    // Mảng thương hiệu không được giành tiêu đề của màn.
    expect(within(panel).queryByRole('heading')).toBeNull();
  });
});

describe('Thương hiệu PMH trên khung đăng nhập (Q-19)', () => {
  function renderCard() {
    return withProviders(
      <AuthCard title="Đăng nhập">
        <p>thân</p>
      </AuthCard>,
    );
  }

  it('mảng trái là ảnh trang trí: <picture> có WebP + JPEG dự phòng, alt rỗng, có kích thước', () => {
    renderCard();
    const panel = screen.getByTestId('auth-panel');
    const picture = panel.querySelector('picture.auth-photo');
    expect(picture).not.toBeNull();
    const source = picture!.querySelector('source')!;
    expect(source).toHaveAttribute('type', 'image/webp');
    expect(source.getAttribute('srcset')).toMatch(/login-photo\.webp$/);
    const img = picture!.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/login-photo\.jpg$/);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('mảng trái có logo PMH đầy đủ tên "Phú Mỹ Hưng", cùng các dòng giới thiệu', () => {
    renderCard();
    const panel = screen.getByTestId('auth-panel');
    const logo = within(panel).getByRole('img', { name: 'Phú Mỹ Hưng' });
    expect(logo.getAttribute('src')).toMatch(/pmh-logo\.png$/);
    expect(logo).toHaveAttribute('width');
    expect(logo).toHaveAttribute('height');
    expect(panel).toHaveTextContent('IMS — Quản lý hệ thống IT');
  });

  it('card có biểu tượng PMH (móc .auth-emblem cho màn hẹp) đứng trước tiêu đề, không còn ô chữ "IMS"', () => {
    const { container } = renderCard();
    const card = container.querySelector<HTMLElement>('.auth-card')!;
    const emblem = within(card).getByRole('img', { name: 'Phú Mỹ Hưng' });
    expect(emblem.closest('.auth-emblem')).not.toBeNull();
    expect(emblem.getAttribute('src')).toMatch(/pmh-emblem\.png$/);
    expect(card.querySelector('.brand-mark')).toBeNull();
    const title = screen.getByRole('heading', { name: 'Đăng nhập' });
    expect(emblem.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * jsdom không dựng CSS, nên đọc thẳng luật: ảnh rộng hơn form (~60/40) và ≤720px chỉ còn card
 * mang biểu tượng. Thiếu một trong hai luật thì màn vẫn "chạy" mà sai bố cục, không gì báo.
 */
describe('auth.css — bố cục ảnh / form', () => {
  const css = readFileSync(join(__dirname, '..', '..', 'css', 'auth.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\r\n/g, '\n');
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = (body: string, selector: string) =>
    new RegExp(`(?:^|[\\n}])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`).exec(body)?.[1] ?? '';
  const narrow = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

  it('màn rộng: cột ảnh 3fr, cột form 2fr; biểu tượng trong card ẩn (logo đầy đủ đã ở mảng ảnh)', () => {
    expect(rule(css, '.auth')).toMatch(/grid-template-columns:[^;]*3fr[^;]*2fr/);
    expect(rule(css, '.auth-emblem')).toMatch(/display:\s*none/);
    expect(rule(css, '.auth-photo img')).toMatch(/object-fit:\s*cover/);
  });

  it('≤720px: bỏ mảng ảnh, hiện biểu tượng trên card', () => {
    expect(rule(narrow, '.auth-panel')).toMatch(/display:\s*none/);
    expect(rule(narrow, '.auth-emblem')).toMatch(/display:\s*(block|flex|grid)/);
  });
});

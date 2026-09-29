import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { clearNextPath, rememberNextPath } from '@/lib/next-path';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { LoginScreen } from './login-screen';

/**
 * Màn đăng nhập trên điện thoại (VLT-FLOW, AUTH-029): email nhớ trên máy, nói tên màn sẽ mở,
 * và báo lỗi bằng tiếng Việt dưới từng ô thay cho bong bóng tiếng Anh của trình duyệt.
 */

function renderLogin() {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/login']}>
      <LoginScreen />
    </MemoryRouter>,
  );
}

async function submitWith(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Mật khẩu'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  clearNextPath();
});

describe('LoginScreen', () => {
  it('đích đã nhớ → dòng phụ nói TÊN MÀN, không in đường dẫn', () => {
    rememberNextPath('/approvals/9f1c2b');
    renderLogin();
    expect(screen.getByText('Đăng nhập để mở: Duyệt mở két')).toBeInTheDocument();
    expect(screen.queryByText(/\/approvals/)).toBeNull();
  });

  it('bấm Đăng nhập khi trống → lỗi tiếng Việt dưới từng ô, không gọi API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(screen.getAllByText('Bắt buộc — chưa nhập ô này.')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('đăng nhập được → nhớ email; lần sau điền sẵn, con trỏ ở ô mật khẩu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { status: 'totp-required', csrfToken: 'x', mustChangePassword: false })),
    );
    const first = renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), ' a@pmh.com.vn ');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await vi.waitFor(() => expect(localStorage.getItem('ims_login_email')).toBe('a@pmh.com.vn'));
    first.unmount();

    renderLogin();
    expect(screen.getByLabelText('Email')).toHaveValue('a@pmh.com.vn');
    expect(screen.getByLabelText('Mật khẩu')).toHaveFocus();
    expect(screen.getByText('Email đã nhớ trên máy này: a@pmh.com.vn.')).toBeInTheDocument();
  });

  it('sai mật khẩu → KHÔNG nhớ email (không lưu thứ chưa chứng minh là của mình)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'LOGIN_FAILED', message: 'Sai email hoặc mật khẩu.' })),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email'), 'a@pmh.com.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'sai');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText('Sai email hoặc mật khẩu.')).toBeInTheDocument();
    expect(localStorage.getItem('ims_login_email')).toBeNull();
  });

  it('"Không phải tôi" → xoá email đã nhớ khỏi máy và khỏi ô', async () => {
    localStorage.setItem('ims_login_email', 'a@pmh.com.vn');
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Không phải tôi' }));
    expect(localStorage.getItem('ims_login_email')).toBeNull();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.queryByText(/Email đã nhớ/)).toBeNull();
  });

  it('kho bị sửa tay thành thứ không phải email → bỏ qua', () => {
    localStorage.setItem('ims_login_email', '<img src=x onerror=alert(1)>');
    renderLogin();
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Không phải tôi' })).toBeNull();
  });
});

describe('LoginScreen — phản hồi theo từng kiểu hỏng', () => {
  it('mở màn chưa nhớ email → con trỏ nằm sẵn ở ô Email, bàn phím điện thoại không viết hoa', () => {
    renderLogin();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('autocapitalize', 'none');
    expect(email).toHaveAttribute('inputmode', 'email');
  });

  it('sai mật khẩu → xoá ô mật khẩu, con trỏ quay về, email giữ nguyên, không thêm câu "bắt buộc"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'LOGIN_FAILED', message: 'Email hoặc mật khẩu không đúng.' })),
    );
    renderLogin();
    await submitWith('a@pmh.com.vn', 'sai-mat-khau');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
    const password = screen.getByLabelText('Mật khẩu');
    expect(password).toHaveValue('');
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveValue('a@pmh.com.vn');
    expect(screen.queryByText('Bắt buộc — chưa nhập ô này.')).toBeNull();
    // Lần sai đầu chưa doạ; lần thứ hai mới nói trước chuyện tạm khoá.
    expect(screen.queryByText(/sẽ bị tạm khóa/)).toBeNull();
    await userEvent.type(password, 'sai-lan-hai');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText(/sẽ bị tạm khóa, thời gian chờ tăng dần/)).toBeInTheDocument();
  });

  it('lỗi mạng → GIỮ mật khẩu: người dùng không gõ sai gì', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderLogin();
    await submitWith('a@pmh.com.vn', 'dung-mat-khau');
    expect(await screen.findByRole('alert')).toHaveTextContent('Đăng nhập không thành công.');
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('dung-mat-khau');
  });

  it('bị tạm khoá → đếm ngược, nút khoá lại và ghi "Chờ m:ss"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { code: 'ACCOUNT_LOCKED', message: 'x', retryAfterSeconds: 272 }),
      ),
    );
    renderLogin();
    await submitWith('a@pmh.com.vn', 'mat-khau');
    expect(await screen.findByText(/Tạm khóa do đăng nhập sai nhiều lần\. Thử lại sau 4:3\d\./)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /^Chờ 4:3\d$/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Liên hệ Super Admin để mở khóa/)).toBeInTheDocument();
  });

  it('bị quản trị khoá tay → câu trung tính + người liên hệ, không đếm ngược', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('support-contact')
            ? jsonResponse(200, { contact: 'Anh Tuấn — máy lẻ 123' })
            : jsonResponse(401, { code: 'ACCOUNT_LOCKED', message: 'x' }),
        ),
      ),
    );
    renderLogin();
    await submitWith('a@pmh.com.vn', 'mat-khau');
    expect(await screen.findByText(/đã bị quản trị viên tạm ngưng/)).toBeInTheDocument();
    expect(await screen.findByText(/Anh Tuấn — máy lẻ 123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeEnabled();
  });

  it('vừa đăng xuất (kể cả sau lượt nạp lại trang) → dải "Bạn đã đăng xuất.", gõ vào là tắt', async () => {
    sessionStorage.setItem('ims_signed_out', '1');
    renderLogin();
    expect(screen.getByRole('status')).toHaveTextContent('Bạn đã đăng xuất.');
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(screen.queryByText('Bạn đã đăng xuất.')).toBeNull();
    expect(sessionStorage.getItem('ims_signed_out')).toBeNull();
  });
});

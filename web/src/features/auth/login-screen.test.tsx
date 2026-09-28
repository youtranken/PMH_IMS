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
    <MemoryRouter>
      <LoginScreen />
    </MemoryRouter>,
  );
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
    expect(screen.getByText('Đăng nhập để mở: Duyệt yêu cầu')).toBeInTheDocument();
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

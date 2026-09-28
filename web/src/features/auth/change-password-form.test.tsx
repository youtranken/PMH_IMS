import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ChangePasswordForm } from './change-password-form';

/**
 * Form đổi mật khẩu báo lỗi bằng tiếng Việt dưới từng ô — `minLength` của trình duyệt từng
 * chặn trước bằng bong bóng tiếng Anh, theo ngôn ngữ trình duyệt chứ không theo app.
 */

afterEach(() => vi.unstubAllGlobals());

function renderForm() {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  renderWithI18n(<ChangePasswordForm csrfToken="tok" variant="dialog" submitLabel="Lưu" />);
  return fetchMock;
}

describe('ChangePasswordForm', () => {
  it('mật khẩu mới ngắn → câu tiếng Việt dưới ô, không gọi API, gợi ý vẫn còn', async () => {
    const fetchMock = renderForm();
    await userEvent.type(screen.getByLabelText('Mật khẩu hiện tại'), 'cu-rat-dai-123');
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Ngan1!');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'Ngan1!');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByText('Cần ít nhất 12 ký tự.')).toBeInTheDocument();
    expect(screen.getByText(/Tối thiểu 12 ký tự/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hai ô lệch nhau → báo dưới ô nhập lại', async () => {
    const fetchMock = renderForm();
    await userEvent.type(screen.getByLabelText('Mật khẩu hiện tại'), 'cu-rat-dai-123');
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'Matkhau12345!');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'Matkhau12346!');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Hai mật khẩu nhập không khớp.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('form mang noValidate — trình duyệt không chen bong bóng của nó vào', () => {
    renderForm();
    expect(screen.getByLabelText('Mật khẩu mới').closest('form')).toHaveAttribute('novalidate');
  });
});

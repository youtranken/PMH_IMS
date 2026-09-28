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
    // Checklist vẫn đứng dưới ô, nói đang có mấy ký tự — không biến mất đúng lúc cần đọc.
    expect(screen.getByText(/Ít nhất 12 ký tự \(đang có 6\)/)).toBeInTheDocument();
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

  it('đủ dài nhưng thiếu nhóm ký tự → báo đúng luật 3/4 nhóm, không gọi API', async () => {
    const fetchMock = renderForm();
    await userEvent.type(screen.getByLabelText('Mật khẩu hiện tại'), 'cu-rat-dai-123');
    await userEvent.type(screen.getByLabelText('Mật khẩu mới'), 'matkhaudaithat');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'matkhaudaithat');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(
      screen.getByText('Cần ít nhất 3 trong 4 nhóm: chữ thường, chữ hoa, số, ký tự đặc biệt.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checklist tick dần khi gõ', async () => {
    renderForm();
    const box = screen.getByLabelText('Mật khẩu mới');
    expect(screen.getByText(/Ít nhất 12 ký tự \(đang có 0\)/).closest('.pw-rule')).not.toHaveClass('ok');
    await userEvent.type(box, 'Mat-Khau-2026');
    expect(screen.getByText(/Ít nhất 12 ký tự \(đang có 13\)/).closest('.pw-rule')).toHaveClass('ok');
    expect(screen.getByText(/đang có 4\):/).closest('.pw-rule')).toHaveClass('ok');
  });

  it('ô mật khẩu có nút hiện/ẩn; gửi form thì tự che lại', async () => {
    renderForm();
    const box = screen.getByLabelText('Mật khẩu mới');
    const [toggle] = screen.getAllByRole('button', { name: 'Hiện mật khẩu' });
    expect(box).toHaveAttribute('type', 'password');
    // Nút thứ nhất thuộc ô "Mật khẩu hiện tại" — bấm nút của ô mới.
    await userEvent.click(screen.getAllByRole('button', { name: 'Hiện mật khẩu' })[1]);
    expect(box).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(box).toHaveAttribute('type', 'password');
  });

  it('form mang noValidate — trình duyệt không chen bong bóng của nó vào', () => {
    renderForm();
    expect(screen.getByLabelText('Mật khẩu mới').closest('form')).toHaveAttribute('novalidate');
  });
});

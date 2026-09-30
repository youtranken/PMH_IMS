import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { PASSWORD_SHOWN_MS, PasswordInput } from './password-input';

/**
 * Q-18: chuỗi mật khẩu đang hiện tự che lại khi rời ô hoặc sau 10 giây — người dùng quên bấm
 * che trên máy dùng chung thì mật khẩu không nằm phơi trên màn.
 */

function renderTwo() {
  renderWithI18n(
    <form>
      <label htmlFor="pw">Mật khẩu</label>
      <PasswordInput id="pw" defaultValue="Mat-Khau-2026" />
      <label htmlFor="other">Ô khác</label>
      <input id="other" />
    </form>,
  );
  return screen.getByLabelText('Mật khẩu');
}

afterEach(() => vi.useRealTimers());

describe('PasswordInput — tự che lại (Q-18)', () => {
  it('rời ô sang chỗ khác → che lại', async () => {
    const box = renderTwo();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(box).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByLabelText('Ô khác'));
    expect(box).toHaveAttribute('type', 'password');
  });

  it('bấm chính nút con mắt KHÔNG tính là rời ô: hiện rồi ẩn được như thường', async () => {
    const box = renderTwo();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(box).toHaveAttribute('type', 'text');
    expect(box).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
    expect(box).toHaveAttribute('type', 'password');
  });

  it('Tab từ ô sang nút con mắt (bàn phím) không che', async () => {
    const box = renderTwo();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Ẩn mật khẩu' })).toHaveFocus();
    expect(box).toHaveAttribute('type', 'text');
    // Tab tiếp ra khỏi nút là đã rời hẳn ô.
    await userEvent.tab();
    expect(screen.getByLabelText('Ô khác')).toHaveFocus();
    expect(box).toHaveAttribute('type', 'password');
  });

  it('đang hiện quá 10 giây → tự che, dù con trỏ vẫn trong ô', () => {
    vi.useFakeTimers();
    const box = renderTwo();
    // fireEvent: userEvent tự chờ bằng setTimeout, dưới đồng hồ giả nó treo.
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(box).toHaveFocus();
    expect(PASSWORD_SHOWN_MS).toBe(10_000);
    act(() => vi.advanceTimersByTime(PASSWORD_SHOWN_MS - 1000));
    expect(box).toHaveAttribute('type', 'text');
    act(() => vi.advanceTimersByTime(1000));
    expect(box).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Hiện mật khẩu' })).toHaveAttribute('aria-pressed', 'false');
  });
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Link, RouterProvider, createMemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LOGIN_PATH } from '@/lib/me';
import { useUnsavedGuard } from './use-unsaved-guard';

function Editor() {
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedGuard(dirty);
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => setDirty(true)}>
        sửa
      </button>
      <Link to="/khac">sang màn khác</Link>
      <Link to="/sua?group=vault">đổi nhóm</Link>
      <button type="button" onClick={() => navigate('/tu-palette')}>
        palette
      </button>
      <button type="button" onClick={() => navigate(LOGIN_PATH)}>
        đăng xuất
      </button>
      {guard.blocked ? (
        <div role="dialog" aria-label="hỏi">
          <button type="button" onClick={guard.stay}>
            ở lại
          </button>
          <button type="button" onClick={guard.proceed}>
            đi tiếp
          </button>
        </div>
      ) : null}
    </>
  );
}

function setup() {
  const router = createMemoryRouter(
    [
      { path: '/sua', element: <Editor /> },
      { path: '*', element: <p>màn khác</p> },
    ],
    { initialEntries: ['/', '/sua'], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

const path = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname;

describe('useUnsavedGuard', () => {
  it('chưa sửa gì: link đi thẳng, không hỏi', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('link', { name: 'sang màn khác' }));
    expect(path(router)).toBe('/khac');
  });

  it('còn thay đổi: bấm link thì dừng lại hỏi; "ở lại" giữ nguyên màn', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('button', { name: 'sửa' }));
    await user.click(screen.getByRole('link', { name: 'sang màn khác' }));
    expect(screen.getByRole('dialog', { name: 'hỏi' })).toBeInTheDocument();
    expect(path(router)).toBe('/sua');
    await user.click(screen.getByRole('button', { name: 'ở lại' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path(router)).toBe('/sua');
  });

  it('còn thay đổi: "đi tiếp" sang đúng đích đã bấm', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('button', { name: 'sửa' }));
    await user.click(screen.getByRole('link', { name: 'sang màn khác' }));
    await user.click(screen.getByRole('button', { name: 'đi tiếp' }));
    expect(path(router)).toBe('/khac');
  });

  it('chặn cả navigate() (Ctrl+K) lẫn nút lùi của trình duyệt', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('button', { name: 'sửa' }));
    await user.click(screen.getByRole('button', { name: 'palette' }));
    expect(screen.getByRole('dialog', { name: 'hỏi' })).toBeInTheDocument();
    expect(path(router)).toBe('/sua');
    await user.click(screen.getByRole('button', { name: 'ở lại' }));

    await act(() => router.navigate(-1));
    expect(screen.getByRole('dialog', { name: 'hỏi' })).toBeInTheDocument();
    expect(path(router)).toBe('/sua');
    await user.click(screen.getByRole('button', { name: 'đi tiếp' }));
    expect(path(router)).toBe('/');
  });

  it('chỉ đổi query trên cùng màn (đổi nhóm/tab) thì không hỏi — màn tự lo', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('button', { name: 'sửa' }));
    await user.click(screen.getByRole('link', { name: 'đổi nhóm' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?group=vault');
  });

  it('không bao giờ chặn đường về màn đăng nhập (đăng xuất, phiên hết hạn)', async () => {
    const { router, user } = setup();
    await user.click(screen.getByRole('button', { name: 'sửa' }));
    await user.click(screen.getByRole('button', { name: 'đăng xuất' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path(router)).toBe(LOGIN_PATH);
  });
});

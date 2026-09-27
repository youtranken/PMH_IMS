import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

const ME: Me = {
  id: 'u-1',
  email: 'it@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30 },
};

function renderShell() {
  return renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AppShell me={ME}>
                <p>Trang chủ</p>
              </AppShell>
            }
          />
          <Route path="/login" element={<p>Màn đăng nhập</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell — đăng xuất', () => {
  it('đăng xuất lỗi (mất mạng) → vẫn về màn đăng nhập VÀ báo lỗi cho người dùng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderShell();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(await screen.findByText(/Đăng xuất chưa thành công/)).toBeInTheDocument();
  });

  it('đăng xuất thành công → về màn đăng nhập, không có toast lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })));
    renderShell();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(screen.queryByText(/Đăng xuất chưa thành công/)).not.toBeInTheDocument();
  });
});

describe('AppShell — mục "sắp có" trong menu', () => {
  it('không phải link, và lời giải thích nằm trong CHỮ (không chỉ trong title)', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).queryByRole('link', { name: /Tài liệu/ })).not.toBeInTheDocument();

    const label = within(nav).getByText('Tài liệu', { exact: true });
    const item = label.parentElement as HTMLElement;
    // `aria-disabled` trên một <span> không vai trò là ARIA sai — trình đọc màn hình bỏ qua nó.
    expect(item).not.toHaveAttribute('aria-disabled');
    expect(item).toHaveTextContent('Phần này chưa mở trong bản hiện tại');
    expect(item).toHaveAttribute('title', 'Phần này chưa mở trong bản hiện tại');
  });
});

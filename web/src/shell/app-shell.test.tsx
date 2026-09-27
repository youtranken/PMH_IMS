import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

const ME: Me = {
  id: 'u-1',
  email: 'it@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'IT_ADMIN' as Me['role'],
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30 },
};

function dung() {
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
    dung();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(await screen.findByText(/Đăng xuất chưa thành công/)).toBeInTheDocument();
  });

  it('đăng xuất thành công → về màn đăng nhập, không có toast lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })));
    dung();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(screen.queryByText(/Đăng xuất chưa thành công/)).not.toBeInTheDocument();
  });
});

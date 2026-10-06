import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * Thư gửi lỗi (Q-25): có thư lỗi thì mục menu của SA mang số — thư break-glass mất mà không ai
 * thấy là lỗ vận hành. Chỉ SA thấy mục và chỉ SA hỏi số (API cũng chỉ mở cho SA).
 */

const base = {
  id: 'u-1',
  email: 'x@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

function renderShell(role: Me['role'], count: number) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    String(input).includes('/api/v1/admin/outbox/failed/count') ? Promise.resolve(jsonResponse(200, { count })) : new Promise<Response>(() => {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <AppShell me={{ ...base, role } as Me}>
          <p>Trang chủ</p>
        </AppShell>
      </MemoryRouter>
    </ToastProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Badge "Thư gửi lỗi" trên menu', () => {
  it('SA có 3 thư lỗi: nhóm "Hệ thống" đang khép vẫn mang số 3; mở ra thì mục "Thư gửi lỗi" mang số, câu đầy đủ qua aria-describedby', async () => {
    renderShell('sa', 3);
    const group = screen.getByRole('button', { name: 'Hệ thống' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(await within(group).findByText('3')).toBeInTheDocument();
    expect(group).toHaveAccessibleDescription('3 Thư gửi lỗi');
    await userEvent.setup().click(group);
    const link = screen.getByRole('link', { name: 'Thư gửi lỗi' });
    expect(within(link).getByText('3')).toBeInTheDocument();
    expect(link).toHaveAccessibleDescription('3 Thư gửi lỗi');
  });

  it('Admin: không có mục, không hỏi số', () => {
    const fetchMock = renderShell('admin', 3);
    expect(screen.queryByRole('link', { name: 'Thư gửi lỗi' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/outbox/'))).toBe(false);
  });
});

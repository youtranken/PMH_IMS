import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * Việc phiếu ISO trên menu (Q-28): số nằm ĐÚNG mục phải mở để làm việc đó — ô ✗ chưa có 0206 ở
 * "Sự cố · 0206", kỳ chờ duyệt / chờ bản ký ở "Kỳ phiếu & chốt kỳ". Gộp chung một số ở Kỳ phiếu
 * thì người dùng mở ra thấy mọi KPI bằng 0 và không biết số đó là gì.
 */

const me = {
  id: 'u-1',
  email: 'x@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'sa',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
} as Me;

function renderShell(todo: { pendingApprovals: number; unlinkedFails: number; awaitingSigned: number }) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const count = todo.pendingApprovals + todo.unlinkedFails + todo.awaitingSigned;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/api/v1/iso/todo') ? Promise.resolve(jsonResponse(200, { count, ...todo })) : new Promise<Response>(() => {}),
    ),
  );
  renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <AppShell me={me}>
          <p>Trang chủ</p>
        </AppShell>
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Badge việc phiếu ISO', () => {
  it('nhóm khép mang tổng; mở ra: số ô ✗ ở "Sự cố · 0206", kỳ chờ duyệt + chờ bản ký ở "Kỳ phiếu & chốt kỳ"', async () => {
    renderShell({ pendingApprovals: 1, unlinkedFails: 2, awaitingSigned: 1 });
    const group = screen.getByRole('button', { name: /Phiếu ISO/ });
    expect(await within(group).findByText('4')).toBeInTheDocument();
    await userEvent.setup().click(group);
    const incidents = screen.getByRole('link', { name: 'Sự cố · 0206' });
    expect(within(incidents).getByText('2')).toBeInTheDocument();
    expect(incidents).toHaveAccessibleDescription('2 Ô ✗ chưa có phiếu 0206');
    const periods = screen.getByRole('link', { name: 'Kỳ phiếu & chốt kỳ' });
    expect(within(periods).getByText('2')).toBeInTheDocument();
    expect(periods).toHaveAccessibleDescription('2 Kỳ phiếu chờ duyệt hoặc chờ bản ký');
  });

  it('chỉ có ô ✗ chưa có phiếu: "Kỳ phiếu & chốt kỳ" không mang số', async () => {
    renderShell({ pendingApprovals: 0, unlinkedFails: 1, awaitingSigned: 0 });
    const group = screen.getByRole('button', { name: /Phiếu ISO/ });
    expect(await within(group).findByText('1')).toBeInTheDocument();
    await userEvent.setup().click(group);
    expect(within(screen.getByRole('link', { name: 'Sự cố · 0206' })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Kỳ phiếu & chốt kỳ' })).queryByText(/\d/)).toBeNull();
  });
});

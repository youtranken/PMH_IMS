import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';

/**
 * SHELL-009 — người duyệt mở app phải THẤY có yêu cầu đang chờ, không phải bấm vào từng mục.
 *
 * Tên link giữ nguyên "Duyệt yêu cầu" (số đi qua `aria-describedby`): đổi tên link theo số là
 * mọi bộ chọn `getByRole('link', { name })` của E2E lệch theo dữ liệu.
 */

const ADMIN: Me = {
  id: 'u-1',
  email: 'admin@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30 },
};

function renderShell(me: Me, narrow = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  return renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <AppShell me={me}>
          <p>Trang chủ</p>
        </AppShell>
      </MemoryRouter>
    </ToastProvider>,
  );
}

function mockCount(count: number) {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    String(input).includes('/break-glass/pending/count')
      ? Promise.resolve(jsonResponse(200, { count }))
      : new Promise<Response>(() => {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('Badge "yêu cầu chờ duyệt" trên menu', () => {
  it('Admin có 2 phiếu chờ → số 2 cạnh mục, link vẫn tên "Duyệt yêu cầu" và mô tả đủ câu', async () => {
    mockCount(2);
    renderShell(ADMIN);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const link = within(nav).getByRole('link', { name: 'Duyệt yêu cầu' });
    expect(await within(link).findByText('2')).toBeInTheDocument();
    expect(link).toHaveAccessibleDescription('2 yêu cầu chờ duyệt');
  });

  it('không có gì chờ → không vẽ badge (số 0 không nói thêm gì)', async () => {
    const fetchMock = mockCount(0);
    renderShell(ADMIN);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const link = screen.getByRole('link', { name: 'Duyệt yêu cầu' });
    expect(link).not.toHaveAccessibleDescription();
  });

  it('điện thoại: nút mở menu mang chấm và mô tả số việc chờ', async () => {
    mockCount(3);
    renderShell(ADMIN, true);
    const toggle = screen.getByRole('button', { name: 'Mở menu' });
    await vi.waitFor(() => expect(toggle).toHaveAccessibleDescription('3 yêu cầu chờ duyệt'));
  });

  it('Member không duyệt → không hỏi số', () => {
    const fetchMock = mockCount(5);
    renderShell({ ...ADMIN, role: 'member' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('pending/count'))).toBe(false);
  });
});

/**
 * Badge "đã quá hạn" trên mục Sắp hết hạn — mọi vai (cả team IT lo hạn). Màu thường, không cam:
 * cam dành cho việc cần một người QUYẾT ngay (duyệt yêu cầu).
 */
function mockOverdue(count: number | 'error') {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/expiry/overdue/count')) {
      return Promise.resolve(
        count === 'error' ? jsonResponse(500, { message: 'hỏng' }) : jsonResponse(200, { count }),
      );
    }
    if (url.includes('/break-glass/pending/count')) {
      return Promise.resolve(jsonResponse(200, { count: 0 }));
    }
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Badge "đã quá hạn" trên mục Sắp hết hạn', () => {
  it('Member có 4 mục quá hạn → số 4 cạnh mục, tên link giữ nguyên, mô tả đủ câu', async () => {
    mockOverdue(4);
    renderShell({ ...ADMIN, role: 'member' });
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const link = within(nav).getByRole('link', { name: 'Sắp hết hạn' });
    const badge = await within(link).findByText('4');
    expect(badge).toHaveClass('nav-badge');
    expect(badge).not.toHaveClass('warn');
    expect(link).toHaveAccessibleDescription('4 mục đã quá hạn');
  });

  it('không có gì quá hạn → không vẽ badge', async () => {
    const fetchMock = mockOverdue(0);
    renderShell(ADMIN);
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('overdue/count'))).toBe(true),
    );
    expect(screen.getByRole('link', { name: 'Sắp hết hạn' })).not.toHaveAccessibleDescription();
  });

  it('API hỏng → im lặng, shell không vỡ', async () => {
    const fetchMock = mockOverdue('error');
    renderShell(ADMIN);
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('overdue/count'))).toBe(true),
    );
    expect(screen.getByRole('link', { name: 'Sắp hết hạn' })).not.toHaveAccessibleDescription();
    expect(screen.getByText('Trang chủ')).toBeInTheDocument();
  });
});

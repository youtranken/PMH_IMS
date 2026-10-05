import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';

/**
 * D-07: bản vẽ chờ duyệt phải có chỗ cho người duyệt THẤY — mục "Sơ đồ mạng" mang số bản vẽ đang
 * chờ người này duyệt. Thành viên không duyệt nên không hỏi.
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
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

function renderShell(me: Me) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
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

const ROW = { approvalId: 'a1', diagramId: 'd1', name: 'Tầng 3 E2E', requester: 'tv@x', requesterName: 'TV', seq: 4, submittedAt: '2026-10-05T01:00:00Z' };

function mockQueue(rows: unknown[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    String(input).includes('/api/v1/diagrams/reviews/pending') ? Promise.resolve(jsonResponse(200, rows)) : new Promise<Response>(() => {}),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Badge "bản vẽ chờ duyệt" trên mục Sơ đồ mạng (D-07)', () => {
  it('Admin có 2 bản vẽ chờ → số 2 cạnh "Sơ đồ mạng", tên link giữ nguyên, mô tả đủ câu', async () => {
    mockQueue([ROW, { ...ROW, approvalId: 'a2', diagramId: 'd2' }]);
    renderShell(ADMIN);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const link = within(nav).getByRole('link', { name: 'Sơ đồ mạng' });
    expect(await within(link).findByText('2')).toBeInTheDocument();
    expect(link).toHaveAccessibleDescription('2 Bản vẽ chờ duyệt');
  });

  it('Thành viên: không hỏi hàng chờ, không badge', () => {
    const fetchMock = mockQueue([ROW]);
    renderShell({ ...ADMIN, role: 'member' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reviews/pending'))).toBe(false);
  });
});

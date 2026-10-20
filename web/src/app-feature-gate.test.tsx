import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { jsonResponse, renderWithI18n, screen, waitFor } from '@/test/test-utils';

/** Q-31: gõ thẳng URL của mảng bị nhóm quyền ẩn thì gặp màn "Không có quyền", không phải màn rỗng. */
function memberWith(features: string[] | null) {
  return {
    id: 'm1',
    email: 'e2e-member@pmh.com.vn',
    fullName: 'Thành viên',
    role: 'member',
    features,
    mustChangePassword: false,
    totpPending: false,
    totpEnrolled: true,
    steppedUpAt: null,
    csrfToken: 'x',
    config: { stepUpGraceMinutes: 5, secretRevealSeconds: 30, fileMaxSizeMb: 10, fileMaxFilesPerBatch: 5 },
  };
}

function serve(features: string[] | null) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/auth/me')
          ? jsonResponse(200, memberWith(features))
          : jsonResponse(200, { items: [], total: 0 }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Cổng nhóm quyền của App (Q-31)', () => {
  it('nhóm chỉ có Mạng mở /devices → màn "không có quyền", không dựng màn Thiết bị', async () => {
    window.history.replaceState(null, '', '/devices');
    serve(['network']);
    renderWithI18n(<App />);
    expect(await screen.findByRole('heading', { name: 'Nhóm quyền của bạn không có mục này' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Thiết bị' })).not.toBeInTheDocument();
  });

  it('nhóm không có Tổng quan: vào / thì sang mục đầu tiên còn hiện trên menu', async () => {
    serve(['network']);
    renderWithI18n(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/ip-addresses'));
  });

  it('không bị giới hạn: /devices vẫn mở như cũ (vế đối chứng)', async () => {
    window.history.replaceState(null, '', '/devices');
    serve(null);
    renderWithI18n(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/devices'));
    expect(screen.queryByRole('heading', { name: 'Nhóm quyền của bạn không có mục này' })).not.toBeInTheDocument();
  });
});

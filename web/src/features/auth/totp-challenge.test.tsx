import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/lib/i18n';
import { ME_KEY } from '@/lib/api';
import { clearSignedOut, signOutNotice } from '@/lib/after-logout';
import type { Me } from '@/lib/me';
import { jsonResponse, render, screen, userEvent } from '@/test/test-utils';
import { TotpChallenge } from './totp-challenge';
import { markTotpChallengeStarted, resetTotpChallengeClock } from './totp-challenge-clock';

const me = {
  email: 'a@pmh.com.vn',
  csrfToken: 'tok',
  totpPending: true,
  totpEnrolled: true,
  config: { totpChallengeMinutes: 5 },
} as Me;

function renderChallenge() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/login/2fa']}>
          <Routes>
            <Route path="/login/2fa" element={<TotpChallenge />} />
            <Route path="/login" element={<p>Màn đăng nhập</p>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Như vừa qua bước mật khẩu ở chính tab này. */
function freshFromLogin() {
  markTotpChallengeStarted();
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetTotpChallengeClock();
  clearSignedOut();
});

function logoutCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/auth/logout');
}

/**
 * Màn nhập mã 2 lớp: nút không bị làm xám (lý do xám không đọc được trên điện thoại), lỗi nằm
 * ngay dưới ô, và sai mã thì con trỏ quay về ô để bàn phím số không đóng.
 */
describe('TotpChallenge', () => {
  it('bấm Xác nhận khi ô trống → "Vui lòng nhập mã xác thực.", không gọi API (Q-20)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    freshFromLogin();
    renderChallenge();
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(screen.getByText('Vui lòng nhập mã xác thực.')).toBeInTheDocument();
    expect(screen.queryByText('Còn thiếu 6 số.')).toBeNull();
    expect(screen.getByLabelText('Mã xác thực')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bấm Xác nhận khi mới có 4 số → nói còn thiếu 2 số, không gọi API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    freshFromLogin();
    renderChallenge();
    const button = screen.getByRole('button', { name: 'Xác nhận' });
    expect(button).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Mã xác thực'), '1234');
    await userEvent.click(button);
    expect(screen.getByText('Còn thiếu 2 số.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã xác thực')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mã sai → câu lỗi dưới ô (ô trỏ tới nó), ô trống và vẫn giữ con trỏ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { code: 'TOTP_INVALID', message: 'Mã không đúng hoặc đã hết hạn.', attemptsLeft: 4 }),
      ),
    );
    freshFromLogin();
    renderChallenge();
    const input = screen.getByLabelText('Mã xác thực');
    await userEvent.type(input, '123456');
    const error = await screen.findByText('Mã không đúng hoặc đã hết hạn.');
    expect(error.id).toBe('otp-error');
    expect(input.getAttribute('aria-describedby')).toContain('otp-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('không còn câu gợi ý dưới ô (Q-20), vẫn giữ "Không lấy được mã?" (Q-18)', () => {
    freshFromLogin();
    renderChallenge();
    expect(screen.queryByText('Mã 6 số đang hiện trong ứng dụng. Nhập mã mới nhất.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Không lấy được mã?' })).toBeInTheDocument();
  });

  it('"Quay lại" đóng phiên chờ ở server rồi về /login, không kèm câu "đã đăng xuất"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'logged-out' }));
    vi.stubGlobal('fetch', fetchMock);
    freshFromLogin();
    renderChallenge();
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    const [, init] = logoutCalls(fetchMock)[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(signOutNotice()).toBeNull();
  });

  it('mở màn mà tab này chưa qua bước mật khẩu (F5, tab mới) → đóng phiên, về /login, báo hết thời gian', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'logged-out' }));
    vi.stubGlobal('fetch', fetchMock);
    renderChallenge();
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(logoutCalls(fetchMock)).toHaveLength(1);
    expect(signOutNotice()).toBe('totpExpired');
  });

  it('để quá N phút (me.config.totpChallengeMinutes) → tự về /login, báo hết thời gian', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'logged-out' }));
    vi.stubGlobal('fetch', fetchMock);
    markTotpChallengeStarted(Date.now() - 5 * 60_000 - 1);
    renderChallenge();
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(signOutNotice()).toBe('totpExpired');
  });

  it('còn trong N phút → ở lại màn nhập mã', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    markTotpChallengeStarted(Date.now() - 60_000);
    renderChallenge();
    expect(screen.getByLabelText('Mã xác thực')).toBeInTheDocument();
    expect(logoutCalls(fetchMock)).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/lib/i18n';
import { ME_KEY } from '@/lib/api';
import type { Me } from '@/lib/me';
import { jsonResponse, render, screen, userEvent } from '@/test/test-utils';
import { TotpChallenge } from './totp-challenge';

const me = { email: 'a@pmh.com.vn', csrfToken: 'tok', totpPending: true, totpEnrolled: true } as Me;

function renderChallenge() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <TotpChallenge />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Màn nhập mã 2 lớp: nút không bị làm xám (lý do xám không đọc được trên điện thoại), lỗi nằm
 * ngay dưới ô, và sai mã thì con trỏ quay về ô để bàn phím số không đóng.
 */
describe('TotpChallenge', () => {
  it('bấm Xác nhận khi mới có 4 số → nói còn thiếu 2 số, không gọi API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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
});

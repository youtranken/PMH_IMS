import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { RevealDialog, type TotpReveal } from '@/ui/reveal-dialog';

/**
 * Mở ngăn "Mã 2 lớp" (Q-18): khóa (che sẵn), QR sinh lại, mã hiện tại chạy theo chu kỳ.
 * Mã các chu kỳ tới do server đưa sẵn — client chỉ chọn mã theo thời gian đã trôi.
 */

const TOTP: TotpReveal = {
  secret: 'JBSWY3DPEHPK3PXP',
  issuer: 'FortiGate',
  account: 'admin',
  digits: 6,
  period: 30,
  qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  codes: ['287082', '359152', '969429'],
  secondsLeft: 12,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

function renderTotp(onClose = () => {}) {
  return renderWithI18n(
    <RevealDialog
      label="VPN FortiGate"
      value="otpauth://totp/FortiGate:admin?secret=JBSWY3DPEHPK3PXP"
      seconds={60}
      totp={TOTP}
      onClose={onClose}
    />,
  );
}

describe('RevealDialog — ngăn Mã 2 lớp', () => {
  it('hiện QR, mã hiện tại và giây còn lại của mã', () => {
    renderTotp();
    const qr = screen.getByRole('img', { name: /Mã QR/ });
    expect(qr).toHaveAttribute('src', TOTP.qrDataUrl);
    expect(screen.getByTestId('totp-code')).toHaveTextContent('287 082');
    expect(screen.getByTestId('totp-code-left')).toHaveTextContent('12s');
    // Chuỗi otpauth thô không in ra: người dùng cần khóa + QR, không cần URI.
    expect(screen.queryByTestId('secret-value')).toBeNull();
  });

  it('khóa bí mật che mặc định; bấm Hiện mới thấy, chia nhóm 4', async () => {
    renderTotp();
    expect(screen.queryByText('JBSW')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Hiện khóa' }));
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn khóa' }));
    expect(screen.queryByTestId('totp-secret')).toBeNull();
  });

  it('hết chu kỳ thì chuyển sang mã kế tiếp server đã đưa', () => {
    renderTotp();
    advance(12);
    expect(screen.getByTestId('totp-code')).toHaveTextContent('359 152');
    expect(screen.getByTestId('totp-code-left')).toHaveTextContent('30s');
    advance(31);
    expect(screen.getByTestId('totp-code')).toHaveTextContent('969 429');
  });

  it('có nút chép khóa và chép mã hiện tại', () => {
    renderTotp();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Chép khóa bí mật' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Chép mã hiện tại' })).toBeInTheDocument();
  });

  it('vẫn tự ẩn sau đúng số giây như mọi ngăn', () => {
    const onClose = vi.fn();
    renderTotp(onClose);
    advance(61);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

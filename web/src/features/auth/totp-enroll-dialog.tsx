import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ME_KEY, errorCode, errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { Dialog } from '@/ui/dialog';
import { OtpInput } from '@/ui/otp-input';
import { PasswordInput } from '@/ui/password-input';
import { StepUpStep } from '@/ui/step-up-dialog';
import { TotpSetup, type TotpSetupData } from './totp-setup';

type Started = TotpSetupData & { ticket?: string };

/**
 * Bật 2 lớp (chưa có) hoặc cài lại trên điện thoại mới (đang có), từ Hồ sơ của tôi.
 *
 * Hai bước giống nhau: mật khẩu hiện tại → quét/nhập khoá → gõ mã đầu tiên. Khác ở cửa API:
 *   · `enable`   → `/auth/totp/enroll` — phiên đã đăng nhập đủ nên API luôn đòi mật khẩu;
 *   · `reenroll` → `/auth/totp/re-enroll` — API đòi THÊM step-up bằng mã của điện thoại hiện tại:
 *     gặp `STEPUP_REQUIRED` thì bước hỏi mã (`StepUpStep`) hiện NGAY TRONG hộp này rồi chạy lại
 *     đúng lượt đó. Không chồng hộp step-up chung lên: câu của hộp ấy nói về việc khác, và hai
 *     hộp chồng nhau người dùng không biết mình đang ở đâu.
 * Điện thoại cũ vẫn dùng được tới khi gõ đúng mã của máy mới — bỏ dở giữa chừng không mất gì.
 * Hộp cảnh báo ở đầu nói trước hệ quả: `confirmReEnroll` thu hồi mọi phiên khác của người này.
 */
export function TotpEnrollDialog({
  mode,
  csrfToken,
  onClose,
  onDone,
}: {
  mode: 'enable' | 'reenroll';
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [needStepUp, setNeedStepUp] = useState(false);
  const [password, setPassword] = useState('');
  const [started, setStarted] = useState<Started | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = <T,>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', csrfToken, body: JSON.stringify(body) });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await post<Started>(
        mode === 'reenroll' ? '/api/v1/auth/totp/re-enroll' : '/api/v1/auth/totp/enroll',
        { currentPassword: password },
      );
      setStarted(result);
    } catch (err) {
      // Giữ mật khẩu: gõ mã xong sẽ gửi lại đúng lượt này.
      if (mode === 'reenroll' && errorCode(err) === 'STEPUP_REQUIRED') {
        setNeedStepUp(true);
        return;
      }
      setPassword('');
      setError(
        errorMessage(err, t('auth.currentPasswordWrong'), (left) =>
          t('auth.attemptsLeft', { count: left }),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!started) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'reenroll') {
        await post('/api/v1/auth/totp/re-enroll/confirm', { ticket: started.ticket, token });
      } else {
        await post('/api/v1/auth/totp/enroll/confirm', { token });
      }
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      onDone();
    } catch (err) {
      setToken('');
      // Vé hết hiệu lực (phiên đổi, API khởi động lại với chìa khác): quay về bước mật khẩu.
      if (errorCode(err) === 'REENROLL_TICKET_INVALID') setStarted(null);
      setError(errorMessage(err, t('auth.totpInvalid')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={480}
      title={mode === 'reenroll' ? t('profile.totpReEnroll') : t('auth.enrollTitle')}
    >
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      {started ? (
        <form
          className="form-grid"
          data-columns={1}
          onSubmit={(e) => {
            e.preventDefault();
            void confirmCode();
          }}
        >
          <TotpSetup data={started} />
          <OtpInput id="profile-otp" value={token} onChange={setToken} label={t('auth.enrollConfirm')} />
          <button type="submit" className="btn primary" disabled={busy || token.length !== 6}>
            {t('auth.totpVerify')}
          </button>
        </form>
      ) : needStepUp ? (
        <StepUpStep
          csrfToken={csrfToken}
          purpose={t('profile.totpReEnrollStepUp')}
          backLabel={t('profile.totpReEnrollBack')}
          onBack={() => setNeedStepUp(false)}
          onDone={() => {
            setNeedStepUp(false);
            void start();
          }}
        />
      ) : (
        <form
          className="form-grid"
          data-columns={1}
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          {mode === 'reenroll' ? (
            <p className="alert warn" role="note">
              {t('profile.totpReEnrollWarning')}
            </p>
          ) : null}
          <p className="muted">
            {mode === 'reenroll' ? t('profile.totpReEnrollHint') : t('profile.totpReEnrollPasswordSub')}
          </p>
          <div className="field">
            <label className="lbl-t" htmlFor="profile-totp-password">
              {t('auth.currentPassword')}
            </label>
            <PasswordInput
              id="profile-totp-password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" disabled={busy || password.length === 0}>
            {t('profile.totpReEnrollContinue')}
          </button>
        </form>
      )}
    </Dialog>
  );
}

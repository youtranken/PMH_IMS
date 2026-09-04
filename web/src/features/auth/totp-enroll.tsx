import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from './auth-card';
import { OtpInput } from '@/ui/otp-input';

interface EnrollStart {
  secret: string;
  qrDataUrl: string;
}

/**
 * Cài xác thực 2 lớp lần đầu (NFR-01: enroll bắt buộc).
 * Secret chỉ hiện MỘT LẦN ở màn này; server đã cất bản mã hóa envelope (AD-4).
 */
export function TotpEnroll() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [enroll, setEnroll] = useState<EnrollStart | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = useApiMutation<undefined, EnrollStart>('/api/v1/auth/totp/enroll', {
    csrfToken: me?.csrfToken ?? null,
  });
  const confirm = useApiMutation<{ token: string }, { status: string }>(
    '/api/v1/auth/totp/enroll/confirm',
    { csrfToken: me?.csrfToken ?? null },
  );

  const startMutate = start.mutate;
  useEffect(() => {
    if (!me?.csrfToken || enroll) return;
    startMutate(undefined, {
      onSuccess: setEnroll,
      onError: (err) => setError(errorMessage(err, 'Không tạo được mã QR.')),
    });
  }, [me?.csrfToken, enroll, startMutate]);

  return (
    <AuthCard title={t('auth.enrollTitle')} subtitle={t('auth.enrollSub')} error={error}>
      {enroll ? (
        <>
          <img
            className="totp-qr"
            src={enroll.qrDataUrl}
            alt={t('auth.enrollQrAlt')}
            width={200}
            height={200}
          />
          <p className="auth-sub">
            {t('auth.enrollManual')} <code className="mono">{enroll.secret}</code>
          </p>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              confirm.mutate(
                { token },
                {
                  onError: (err) => {
                    setToken('');
                    setError(errorMessage(err, 'Mã xác thực không đúng.'));
                  },
                },
              );
            }}
          >
            <OtpInput value={token} onChange={setToken} label={t('auth.enrollConfirm')} />
            <button
              type="submit"
              className="btn primary"
              disabled={confirm.isPending || token.length !== 6}
            >
              {t('auth.totpVerify')}
            </button>
          </form>
        </>
      ) : (
        <p className="auth-sub">{t('common.loading')}</p>
      )}
    </AuthCard>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from '@/features/auth/auth-card';
import { OtpInput } from '@/features/auth/otp-input';

/** Bước 2 của đăng nhập: nhập mã 6 số từ ứng dụng Authenticator. */
export function TotpChallenge() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = useApiMutation<{ token: string }, { mustChangePassword: boolean }>(
    '/api/v1/auth/login/totp',
    { csrfToken: me?.csrfToken ?? null },
  );

  return (
    <AuthCard title={t('auth.totpTitle')} subtitle={t('auth.totpSub')} error={error}>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          verify.mutate(
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
        <OtpInput value={token} onChange={setToken} label={t('auth.totpCode')} />
        <button type="submit" className="btn primary" disabled={verify.isPending || token.length !== 6}>
          {t('auth.totpVerify')}
        </button>
      </form>
    </AuthCard>
  );
}

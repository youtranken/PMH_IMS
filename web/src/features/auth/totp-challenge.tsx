import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from './auth-card';
import { SupportHelp } from './support-help';
import { OtpInput, useOtpSubmit } from '@/ui/otp-input';

/**
 * Bước 2 của đăng nhập: nhập mã 6 số từ ứng dụng Authenticator. Đủ 6 số là tự gửi — người mở
 * thư duyệt trên điện thoại dán mã xong là vào, không phải tìm nút.
 */
export function TotpChallenge() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = useApiMutation<{ token: string }, { mustChangePassword: boolean }>(
    '/api/v1/auth/login/totp',
    { csrfToken: me?.csrfToken ?? null },
  );

  const submit = useOtpSubmit(async (code) => {
    setError(null);
    try {
      await verify.mutateAsync({ token: code });
    } catch (err) {
      setToken('');
      setError(
        errorMessage(err, t('auth.totpInvalid'), (left) => t('auth.attemptsLeft', { count: left })),
      );
    }
  });

  return (
    <AuthCard
      title={t('auth.totpTitle')}
      subtitle={t('auth.totpSub')}
      error={error}
      signedInAs={me}
      footer={<SupportHelp kind="totp" />}
    >
      <form
        className="auth-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(token);
        }}
      >
        <OtpInput
          value={token}
          onChange={setToken}
          onComplete={(code) => void submit(code)}
          label={t('auth.totpCode')}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={verify.isPending || token.length !== 6}
          /* Nút xám vì mã chưa đủ 6 số — nói ra, đừng để người dùng bấm rồi tự đoán. */
          title={token.length !== 6 ? t('auth.totpNeedSix') : undefined}
        >
          {t('auth.totpVerify')}
        </button>
      </form>
    </AuthCard>
  );
}

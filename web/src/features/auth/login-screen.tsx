import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { AuthCard } from '@/features/auth/auth-card';

interface LoginResult {
  status: 'authenticated' | 'totp-required' | 'totp-enroll-required';
  csrfToken: string;
  mustChangePassword: boolean;
}

/** Bước 1 của đăng nhập: email + mật khẩu (NFR-01). */
export function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useApiMutation<{ email: string; password: string }, LoginResult>(
    '/api/v1/auth/login',
  );

  return (
    <AuthCard title={t('auth.signInTitle')} subtitle={t('auth.signInSub')} error={error}>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          // Không tự navigate: sau khi `me` được nạp lại, router đưa tới đúng bước còn thiếu
          // (nextStepPath) — xem App.tsx.
          login.mutate(
            { email: email.trim(), password },
            { onError: (err) => setError(errorMessage(err, 'Đăng nhập không thành công.')) },
          );
        }}
      >
        <div className="field">
          <label className="lbl-t" htmlFor="login-email">
            {t('auth.email')}
          </label>
          <input
            id="login-email"
            className="inp"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="lbl-t" htmlFor="login-password">
            {t('auth.password')}
          </label>
          <input
            id="login-password"
            className="inp"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn primary" disabled={login.isPending}>
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </AuthCard>
  );
}

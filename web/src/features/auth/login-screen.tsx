import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { nextPathLabelKey, peekNextPath } from '@/lib/next-path';
import {
  forgetRememberedEmail,
  readRememberedEmail,
  rememberEmail,
} from '@/lib/remembered-email';
import { Field } from '@/ui/page-header';
import { useFormErrors } from '@/ui/use-form-errors';
import { AuthCard } from './auth-card';
import { SupportHelp } from './support-help';

interface LoginResult {
  status: 'authenticated' | 'totp-required' | 'totp-enroll-required';
  csrfToken: string;
  mustChangePassword: boolean;
}

/**
 * Bước 1 của đăng nhập: email + mật khẩu (NFR-01).
 *
 * Email đăng nhập thành công được nhớ trên thiết bị: người duyệt mở thư trên điện thoại chỉ còn
 * gõ mật khẩu. Máy dùng chung thì "Không phải tôi?" xoá nó ngay trên màn này.
 */
export function LoginScreen() {
  const { t } = useTranslation();
  const [remembered, setRemembered] = useState(() => readRememberedEmail());
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const login = useApiMutation<{ email: string; password: string }, LoginResult>(
    '/api/v1/auth/login',
  );

  // Đích đã nhớ (link trong mail…): nói TÊN MÀN sẽ mở sau khi đăng nhập, không in đường dẫn.
  const [nextKey] = useState(() => nextPathLabelKey(peekNextPath()));

  const check = useFormErrors({
    email: !email.trim() && t('formErrors.required'),
    password: !password && t('formErrors.required'),
  });

  return (
    <AuthCard
      title={t('auth.signInTitle')}
      subtitle={nextKey ? t('auth.resumeTo', { screen: t(nextKey) }) : t('auth.signInSub')}
      error={error}
      footer={<SupportHelp kind="password" />}
    >
      <form
        className="auth-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const typed = email.trim();
          // Không tự navigate: sau khi `me` được nạp lại, router đưa tới đúng bước còn thiếu
          // (nextStepPath) — xem App.tsx.
          login.mutate(
            { email: typed, password },
            {
              onSuccess: () => rememberEmail(typed),
              onError: (err) => setError(errorMessage(err, t('auth.loginFailed'))),
            },
          );
        }}
      >
        {remembered ? (
          <p className="auth-sub">
            {t('auth.rememberedAs', { email: remembered })}{' '}
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                forgetRememberedEmail();
                setRemembered('');
                setEmail('');
                emailRef.current?.focus();
              }}
            >
              {t('auth.notMe')}
            </button>
          </p>
        ) : null}

        <Field label={t('auth.email')} htmlFor="login-email" error={check.error('email')}>
          <input
            ref={emailRef}
            className="inp"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label={t('auth.password')} htmlFor="login-password" error={check.error('password')}>
          <input
            className="inp"
            type="password"
            autoComplete="current-password"
            required
            // Email đã điền sẵn thì việc còn lại là mật khẩu — đưa con trỏ tới đó luôn.
            autoFocus={Boolean(remembered)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <button type="submit" className="btn primary" disabled={login.isPending}>
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </AuthCard>
  );
}

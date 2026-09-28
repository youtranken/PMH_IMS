import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { clearSignedOut, justSignedOut } from '@/lib/after-logout';
import { classifyLoginError, formatWait, type LoginErrorKind } from '@/lib/login-error';
import { nextPathLabelKey, peekNextPath } from '@/lib/next-path';
import {
  forgetRememberedEmail,
  readRememberedEmail,
  rememberEmail,
} from '@/lib/remembered-email';
import { Field } from '@/ui/page-header';
import { PasswordInput } from '@/ui/password-input';
import { useFormErrors } from '@/ui/use-form-errors';
import { useNow } from '@/ui/use-now';
import { AuthCard } from './auth-card';
import { AUTH_ERROR_ID, clearSetupSteps } from './setup-steps';
import { SupportHelp } from './support-help';

interface LoginResult {
  status: 'authenticated' | 'totp-required' | 'totp-enroll-required';
  csrfToken: string;
  mustChangePassword: boolean;
}

/** Lượt sai thứ mấy thì nhắc trước chuyện tạm khoá (Q-06: chờ 5→15→30→60 phút). */
const WARN_FROM_WRONG = 2;

/**
 * Bước 1 của đăng nhập: email + mật khẩu (NFR-01).
 *
 * Email đăng nhập thành công được nhớ trên thiết bị: người duyệt mở thư trên điện thoại chỉ còn
 * gõ mật khẩu. Máy dùng chung thì "Không phải tôi?" xoá nó ngay trên màn này.
 *
 * Mỗi kiểu hỏng làm một việc khác nhau (`classifyLoginError`): sai mật khẩu thì xoá ô và đưa con
 * trỏ về; bị tạm khoá thì đếm ngược và khoá nút — bấm thêm trong lúc chờ là thêm một lượt sai
 * và có thể đẩy lên bậc chờ dài hơn; bị quản trị khoá thì chỉ người mở.
 */
export function LoginScreen() {
  const { t } = useTranslation();
  const [remembered, setRemembered] = useState(() => readRememberedEmail());
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<{ kind: LoginErrorKind; message: string } | null>(null);
  const [wrongCount, setWrongCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  // Vừa bấm Đăng xuất: nói ra là phiên đã đóng — trên máy dùng chung người ta cần chắc điều đó.
  const [signedOut, setSignedOut] = useState(justSignedOut);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const now = useNow(1000, lockedUntil !== null);
  const waitLeft = lockedUntil === null ? 0 : Math.ceil((lockedUntil - now) / 1000);
  const waiting = waitLeft > 0;

  const login = useApiMutation<{ email: string; password: string }, LoginResult>(
    '/api/v1/auth/login',
  );

  // Một lượt đăng nhập mới là một luồng cài đặt mới — "Bước 1/2" đếm lại từ đầu.
  useEffect(() => clearSetupSteps(), []);

  // Hết giờ chờ: bỏ câu báo, nhả nút — người dùng không phải tải lại trang.
  useEffect(() => {
    if (lockedUntil !== null && !waiting) {
      setLockedUntil(null);
      setFailure(null);
    }
  }, [lockedUntil, waiting]);

  const needsContact = failure?.kind === 'locked' || failure?.kind === 'disabled';
  const contact = useQuery({
    queryKey: ['auth', 'support-contact'],
    queryFn: () => apiFetch<{ contact: string }>('/api/v1/auth/support-contact'),
    enabled: needsContact,
    staleTime: 5 * 60_000,
  });

  // Đích đã nhớ (link trong mail…): nói TÊN MÀN sẽ mở sau khi đăng nhập, không in đường dẫn.
  const [nextKey] = useState(() => nextPathLabelKey(peekNextPath()));

  const check = useFormErrors({
    email: !email.trim() && t('formErrors.required'),
    password: !password && t('formErrors.required'),
  });

  const wrong = failure?.kind === 'wrong';
  let errorBody: ReactNode = null;
  let errorTone: 'danger' | 'warn' | 'neutral' = 'danger';
  if (failure?.kind === 'wait' && waiting) {
    errorTone = 'warn';
    errorBody = (
      <>
        <p>{t('auth.lockedWait', { time: formatWait(waitLeft) })}</p>
        <p>{t('auth.lockedUrgent')}</p>
      </>
    );
  } else if (failure?.kind === 'locked' || failure?.kind === 'disabled') {
    errorTone = 'neutral';
    errorBody = (
      <>
        <p>{t(failure.kind === 'locked' ? 'auth.lockedByAdmin' : 'auth.accountDisabled')}</p>
        {contact.data ? (
          <p>
            <strong>{t('auth.supportContactLabel')}:</strong> {contact.data.contact}
          </p>
        ) : null}
      </>
    );
  } else if (failure && failure.kind !== 'wait') {
    errorBody = (
      <>
        <p>{failure.message}</p>
        {/* KHÔNG kèm số lần còn lại: con số đó lộ ra email nào có thật (dò tài khoản). */}
        {wrong && wrongCount >= WARN_FROM_WRONG ? <p>{t('auth.lockoutWarning')}</p> : null}
      </>
    );
  }

  const typed = () => {
    setSignedOut(false);
    clearSignedOut();
  };

  return (
    <AuthCard
      title={t('auth.signInTitle')}
      subtitle={nextKey ? t('auth.resumeTo', { screen: t(nextKey) }) : t('auth.signInSub')}
      error={errorBody}
      errorTone={errorTone}
      notice={signedOut ? t('auth.signedOut') : null}
      footer={<SupportHelp kind="password" />}
    >
      <form
        className="auth-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (waiting) return;
          setFailure(null);
          typed();
          if (!check.check()) return;
          const typedEmail = email.trim();
          // Không tự navigate: sau khi `me` được nạp lại, router đưa tới đúng bước còn thiếu
          // (nextStepPath) — xem App.tsx.
          login.mutate(
            { email: typedEmail, password },
            {
              onSuccess: () => rememberEmail(typedEmail),
              onError: (err) => {
                const kind = classifyLoginError(err);
                if (kind.clearPassword) {
                  // Giữ email, xoá chuỗi sai và đưa con trỏ về: người dùng gõ lại ngay được.
                  setPassword('');
                  check.reset();
                  setWrongCount((n) => n + 1);
                  passwordRef.current?.focus();
                }
                if (kind.retryAfterSeconds !== null) {
                  setLockedUntil(Date.now() + kind.retryAfterSeconds * 1000);
                }
                setFailure({ kind: kind.kind, message: errorMessage(err, t('auth.loginFailed')) });
              },
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
            // Bàn phím điện thoại: bố cục email, không tự viết hoa chữ đầu, không sửa chính tả.
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            // Chưa nhớ email thì ô email là việc đầu tiên — con trỏ nằm sẵn ở đó.
            autoFocus={!remembered}
            aria-invalid={wrong ? true : undefined}
            aria-describedby={wrong ? AUTH_ERROR_ID : undefined}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              typed();
            }}
          />
        </Field>

        <Field label={t('auth.password')} htmlFor="login-password" error={check.error('password')}>
          <PasswordInput
            ref={passwordRef}
            autoComplete="current-password"
            required
            // Email đã điền sẵn thì việc còn lại là mật khẩu — đưa con trỏ tới đó luôn.
            autoFocus={Boolean(remembered)}
            aria-invalid={wrong ? true : undefined}
            aria-describedby={wrong ? AUTH_ERROR_ID : undefined}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              typed();
            }}
          />
        </Field>

        <button type="submit" className="btn primary" disabled={login.isPending || waiting}>
          {waiting
            ? t('auth.lockedWaitButton', { time: formatWait(waitLeft) })
            : login.isPending
              ? t('auth.signingIn')
              : t('auth.signIn')}
        </button>
      </form>
    </AuthCard>
  );
}

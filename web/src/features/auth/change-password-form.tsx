import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';

/**
 * Phần form đổi mật khẩu — MỘT bản cho cả màn đổi bắt buộc (card đăng nhập) lẫn hộp thoại ở Hồ
 * sơ của tôi. Luôn đòi mật khẩu hiện tại: API đòi nó ở cả hai đường (cookie trộm được không đổi
 * được mật khẩu), nên form không có biến thể nào bỏ ô này.
 *
 * `variant` chỉ đổi lớp CSS: card đăng nhập luôn tối (token `--auth-*`), hộp thoại theo theme app.
 */
export function ChangePasswordForm({
  csrfToken,
  variant,
  submitLabel,
  onChanged,
}: {
  csrfToken: string | null;
  variant: 'auth' | 'dialog';
  submitLabel: string;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const prefix = variant === 'auth' ? 'cp' : 'cpd';

  const change = useApiMutation<
    { currentPassword: string; newPassword: string },
    { status: string }
  >('/api/v1/auth/change-password', { csrfToken });

  return (
    <form
      className={variant === 'auth' ? 'auth-form' : 'form-grid'}
      data-columns={variant === 'auth' ? undefined : 1}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (newPassword !== repeat) {
          setError(t('auth.passwordMismatch'));
          return;
        }
        change.mutate(
          { currentPassword, newPassword },
          {
            onSuccess: () => onChanged?.(),
            onError: (err) =>
              setError(
                errorMessage(err, t('auth.changePasswordFailed'), (left) =>
                  t('auth.attemptsLeft', { count: left }),
                ),
              ),
          },
        );
      }}
    >
      {error ? (
        <p className={variant === 'auth' ? 'auth-error' : 'alert error'} role="alert">
          {error}
        </p>
      ) : null}

      <div className="field">
        <label className="lbl-t" htmlFor={`${prefix}-current`}>
          {t('auth.currentPassword')}
        </label>
        <input
          id={`${prefix}-current`}
          className="inp"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="lbl-t" htmlFor={`${prefix}-new`}>
          {t('auth.newPassword')}
        </label>
        <input
          id={`${prefix}-new`}
          className="inp"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          aria-describedby={`${prefix}-hint`}
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <span className="field-hint" id={`${prefix}-hint`}>
          {t('auth.passwordHint')}
        </span>
      </div>

      <div className="field">
        <label className="lbl-t" htmlFor={`${prefix}-repeat`}>
          {t('auth.confirmPassword')}
        </label>
        <input
          id={`${prefix}-repeat`}
          className="inp"
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </div>

      <button type="submit" className="btn primary" disabled={change.isPending}>
        {submitLabel}
      </button>
    </form>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation, useMe } from '@/lib/api';
import { AuthCard } from './auth-card';

/** Đổi mật khẩu — bắt buộc ở lần đăng nhập đầu (mật khẩu tạm do SA cấp). */
export function ChangePassword() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);

  const change = useApiMutation<
    { currentPassword: string; newPassword: string },
    { status: string }
  >('/api/v1/auth/change-password', { csrfToken: me?.csrfToken ?? null });

  return (
    <AuthCard
      title={t('auth.changePasswordTitle')}
      subtitle={me?.mustChangePassword ? t('auth.changePasswordSub') : undefined}
      error={error}
    >
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (newPassword !== repeat) {
            setError(t('auth.passwordMismatch'));
            return;
          }
          change.mutate(
            { currentPassword, newPassword },
            { onError: (err) => setError(errorMessage(err, 'Không đổi được mật khẩu.')) },
          );
        }}
      >
        <div className="field">
          <label className="lbl-t" htmlFor="cp-current">
            {t('auth.currentPassword')}
          </label>
          <input
            id="cp-current"
            className="inp"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="lbl-t" htmlFor="cp-new">
            {t('auth.newPassword')}
          </label>
          <input
            id="cp-new"
            className="inp"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
          <span className="field-hint muted">{t('auth.passwordHint')}</span>
        </div>

        <div className="field">
          <label className="lbl-t" htmlFor="cp-repeat">
            {t('auth.confirmPassword')}
          </label>
          <input
            id="cp-repeat"
            className="inp"
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>

        <button type="submit" className="btn primary" disabled={change.isPending}>
          {t('common.save')}
        </button>
      </form>
    </AuthCard>
  );
}

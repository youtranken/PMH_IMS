import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { PASSWORD_MIN_LENGTH, checkPasswordRules } from '@/lib/password-rules';
import { Field } from '@/ui/page-header';
import { PasswordInput } from '@/ui/password-input';
import { useFormErrors } from '@/ui/use-form-errors';
import { PasswordChecklist } from './password-checklist';

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
  const rules = checkPasswordRules(newPassword);

  const change = useApiMutation<
    { currentPassword: string; newPassword: string },
    { status: string }
  >('/api/v1/auth/change-password', { csrfToken });

  /* Nhãn ô KHÔNG mang dấu `*` (xem `Field.required`): cả ba ô đều bắt buộc, dấu không phân biệt
     được gì — nhưng lỗi vẫn phải nói bằng tiếng Việt, dưới đúng ô. */
  const check = useFormErrors({
    current: !currentPassword && t('formErrors.required'),
    next:
      rules.reason === 'empty'
        ? t('formErrors.required')
        : rules.reason === 'short'
          ? t('formErrors.minLength', { min: PASSWORD_MIN_LENGTH })
          : rules.reason === 'groups' && t('auth.passwordGroupsError'),
    repeat: !repeat
      ? t('formErrors.required')
      : repeat !== newPassword && t('auth.passwordMismatch'),
  });

  return (
    <form
      className={variant === 'auth' ? 'auth-form' : 'form-grid'}
      data-columns={variant === 'auth' ? undefined : 1}
      ref={check.formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!check.check()) return;
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

      <Field
        label={t('auth.currentPassword')}
        htmlFor={`${prefix}-current`}
        error={check.error('current')}
      >
        <PasswordInput
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>

      <div className="field-group">
        <Field
          label={t('auth.newPassword')}
          htmlFor={`${prefix}-new`}
          error={check.error('next')}
        >
          <PasswordInput
            autoComplete="new-password"
            required
            aria-describedby={
              [check.error('next') ? `${prefix}-new-error` : null, `${prefix}-rules`]
                .filter(Boolean)
                .join(' ')
            }
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
        </Field>
        {/* Dòng "Hai mật khẩu khớp" nằm SẴN trong checklist và chỉ đổi ○/✓, không mọc thêm dòng
            lúc rời ô: dòng mọc ra đúng lúc bấm chuột xuống nút đẩy nút trôi, nhả chuột rơi ra
            ngoài nút và cú bấm mất. */}
        <PasswordChecklist password={newPassword} repeat={repeat} id={`${prefix}-rules`} />
      </div>

      <Field
        label={t('auth.confirmPassword')}
        htmlFor={`${prefix}-repeat`}
        error={check.error('repeat')}
      >
        <PasswordInput
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </Field>

      <button type="submit" className="btn primary" disabled={change.isPending}>
        {change.isPending ? t('auth.changingPassword') : submitLabel}
      </button>
    </form>
  );
}

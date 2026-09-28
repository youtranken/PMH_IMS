import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/api';
import { AuthCard } from './auth-card';
import { ChangePasswordForm } from './change-password-form';

/** Đổi mật khẩu — bắt buộc ở lần đăng nhập đầu (mật khẩu tạm do SA cấp). */
export function ChangePassword() {
  const { t } = useTranslation();
  const { data: me } = useMe();

  return (
    <AuthCard
      title={t('auth.changePasswordTitle')}
      subtitle={me?.mustChangePassword ? t('auth.changePasswordSub') : undefined}
      signedInAs={me}
    >
      {/* Không tự navigate khi xong: `me` nạp lại thì router đưa tới đúng bước kế (App.tsx). */}
      <ChangePasswordForm
        csrfToken={me?.csrfToken ?? null}
        variant="auth"
        submitLabel={t('common.save')}
      />
    </AuthCard>
  );
}

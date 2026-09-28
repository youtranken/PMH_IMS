import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/api';
import { useToast } from '@/ui/toast';
import { AuthCard } from './auth-card';
import { ChangePasswordForm } from './change-password-form';

/** Đổi mật khẩu — bắt buộc ở lần đăng nhập đầu (mật khẩu tạm do SA cấp). */
export function ChangePassword() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const toast = useToast();

  return (
    <AuthCard
      title={t('auth.changePasswordTitle')}
      subtitle={me?.mustChangePassword ? t('auth.changePasswordSub') : undefined}
      signedInAs={me}
      setupFor={me}
    >
      {/* Không tự navigate khi xong: `me` nạp lại thì router đưa tới đúng bước kế (App.tsx).
          Nhãn nút nói việc sẽ xảy ra ("đổi rồi đi tiếp"), không phải chữ "Lưu" của form CRUD. */}
      <ChangePasswordForm
        csrfToken={me?.csrfToken ?? null}
        variant="auth"
        submitLabel={t('auth.changePasswordSubmit')}
        onChanged={() => toast({ message: t('auth.passwordChanged'), tone: 'ok' })}
      />
    </AuthCard>
  );
}

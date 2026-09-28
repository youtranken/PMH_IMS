import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/lib/api';
import { afterLogout } from '@/lib/after-logout';
import type { Me } from '@/lib/me';

/** "Không phải {email}? Đăng xuất" — lối thoát khỏi phiên dở giữa luồng đăng nhập. */
export function SignOutLink({ account }: { account: Pick<Me, 'email' | 'csrfToken'> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useApiMutation<undefined, { status: string }>('/api/v1/auth/logout', {
    csrfToken: account.csrfToken,
  });
  return (
    <p>
      {t('auth.notYou', { email: account.email })}{' '}
      <button
        type="button"
        className="auth-link"
        disabled={logout.isPending}
        onClick={() =>
          // onSettled: kể cả API hỏng cũng phải xoá dữ liệu trên máy (FE-02), rồi về màn đăng nhập.
          logout.mutate(undefined, { onSettled: () => afterLogout(queryClient, navigate) })
        }
      >
        {logout.isPending ? t('auth.signingOut') : t('auth.signOut')}
      </button>
    </p>
  );
}

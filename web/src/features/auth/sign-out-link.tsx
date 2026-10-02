import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/lib/api';
import { afterLogout, type SignOutReason } from '@/lib/after-logout';
import type { Me } from '@/lib/me';

/**
 * Đóng phiên dở giữa luồng đăng nhập rồi về `/login` — MỘT đường cho cả "Không phải …? Đăng
 * xuất", "Quay lại" và "hết thời gian nhập mã". Router ép phiên chờ ở lại đúng bước còn thiếu,
 * nên chỉ đổi màn mà không đóng phiên thì người dùng bị đá ngược về đúng màn vừa rời.
 */
export function useSignOutMidFlow(account: Pick<Me, 'csrfToken'> | null | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useApiMutation<undefined, { status: string }>('/api/v1/auth/logout', {
    csrfToken: account?.csrfToken ?? null,
  });
  const signOut = (reason: SignOutReason) =>
    // onSettled: kể cả API hỏng (phiên đã chết ở server) cũng phải xoá dữ liệu trên máy (FE-02),
    // rồi về màn đăng nhập.
    logout.mutate(undefined, { onSettled: () => afterLogout(queryClient, navigate, reason) });
  return { signOut, pending: logout.isPending };
}

/**
 * `notYou` (mặc định): "Không phải {email}? Đăng xuất" ở chân card.
 * `back`: nút "Quay lại" của màn nhập mã 2 lớp (Q-20) — giữ trang đang mở dở để đăng nhập lại
 * xong vẫn về đó (Q-14).
 */
export function SignOutLink({
  account,
  variant = 'notYou',
}: {
  account: Pick<Me, 'email' | 'csrfToken'>;
  variant?: 'notYou' | 'back';
}) {
  const { t } = useTranslation();
  const { signOut, pending } = useSignOutMidFlow(account);
  if (variant === 'back') {
    return (
      <button type="button" className="btn auth-secondary" disabled={pending} onClick={() => signOut('back')}>
        {pending ? t('auth.totpBacking') : t('auth.totpBack')}
      </button>
    );
  }
  return (
    <p>
      {t('auth.notYou', { email: account.email })}{' '}
      <button type="button" className="auth-link" disabled={pending} onClick={() => signOut('signedOut')}>
        {pending ? t('auth.signingOut') : t('auth.signOut')}
      </button>
    </p>
  );
}

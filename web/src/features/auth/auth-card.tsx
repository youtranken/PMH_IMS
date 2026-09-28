import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@/lib/me';
import { SignOutLink } from './sign-out-link';

/**
 * Khung dùng chung cho mọi màn ngoài shell (đăng nhập, nhập TOTP, cài 2 lớp, đổi mật khẩu).
 * AD-15: bốn màn đó KHÔNG mỗi màn một layout.
 *
 * `signedInAs`: ba màn GIỮA luồng (đã qua mật khẩu) phải cho thấy đang xác thực cho tài khoản
 * nào và có lối thoát — router ép người dùng ở lại đúng bước còn thiếu, nên thiếu nút Đăng xuất
 * thì người gõ nhầm tài khoản hay đang dùng máy chung chỉ còn cách xoá cookie.
 */
export function AuthCard({
  title,
  subtitle,
  error,
  children,
  footer,
  signedInAs,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  signedInAs?: Pick<Me, 'email' | 'csrfToken'> | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="ims auth">
      <section className="auth-card">
        <div className="auth-logo">
          <span className="brand-mark" aria-hidden="true">
            IMS
          </span>
          <span>{t('app.brand')}</span>
        </div>
        <div>
          <h1 className="auth-title">{title}</h1>
          {signedInAs ? (
            <p className="auth-sub" data-testid="auth-signed-in-as">
              {t('auth.signingInAs', { email: signedInAs.email })}
            </p>
          ) : null}
          {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
        </div>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        {children}
        {footer || signedInAs ? (
          <div className="auth-foot">
            {footer}
            {signedInAs ? <SignOutLink account={signedInAs} /> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

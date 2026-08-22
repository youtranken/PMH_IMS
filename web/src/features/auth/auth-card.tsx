import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Khung dùng chung cho mọi màn ngoài shell (đăng nhập, nhập TOTP, cài 2 lớp, đổi mật khẩu).
 * AD-15: bốn màn đó KHÔNG mỗi màn một layout.
 */
export function AuthCard({
  title,
  subtitle,
  error,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
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
          {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
        </div>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        {children}
        {footer ? <div className="auth-foot">{footer}</div> : null}
      </section>
    </div>
  );
}

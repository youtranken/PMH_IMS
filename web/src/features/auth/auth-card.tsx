import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@/lib/me';
import { BrandEmblem, BrandLogo } from '@/ui/brand-logo';
import { AUTH_ERROR_ID, useSetupStep } from './setup-steps';
import { SignOutLink } from './sign-out-link';

/**
 * Khung dùng chung cho mọi màn ngoài shell (đăng nhập, nhập TOTP, cài 2 lớp, đổi mật khẩu).
 * AD-15: bốn màn đó KHÔNG mỗi màn một layout.
 *
 * `signedInAs`: ba màn GIỮA luồng (đã qua mật khẩu) phải cho thấy đang xác thực cho tài khoản
 * nào và có lối thoát — router ép người dùng ở lại đúng bước còn thiếu, nên thiếu nút Đăng xuất
 * thì người gõ nhầm tài khoản hay đang dùng máy chung chỉ còn cách xoá cookie.
 *
 * `setupFor`: màn thuộc luồng cài đặt lần đầu thì nói "Bước 1/2" — các màn trông giống hệt nhau,
 * không có dấu mốc thì người mới tưởng bị lặp và bỏ ngang.
 *
 * `errorTone`: "đang tạm khoá, chờ chút" không phải lỗi người dùng vừa gây ra; tô đỏ nó thì
 * người ta nghĩ mình lại gõ sai và bấm tiếp.
 *
 * Mảng thương hiệu bên trái (chỉ màn rộng, CSS ẩn nó ≤720px): người mở link từ thư cần chắc đây
 * là trang thật của PMH trước khi gõ mật khẩu. Nó không có tiêu đề — `h1` của màn vẫn là tiêu đề
 * của card. Ảnh nền là trang trí (`alt=""`); tên công ty đã nằm ở alt của logo và dòng chữ.
 * Màn hẹp không có mảng đó, nên biểu tượng PMH trong card (`.auth-emblem`) gánh việc nhận diện;
 * màn rộng CSS ẩn biểu tượng đi vì logo đầy đủ đã ở bên trái.
 */
export function AuthCard({
  title,
  subtitle,
  error,
  errorTone = 'danger',
  notice,
  children,
  footer,
  signedInAs,
  setupFor,
}: {
  title: string;
  subtitle?: string;
  error?: ReactNode;
  errorTone?: 'danger' | 'warn' | 'neutral';
  /** Dải thông tin trung tính trên form (vd "Bạn đã đăng xuất.") — không phải lỗi. */
  notice?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  signedInAs?: Pick<Me, 'email' | 'csrfToken'> | null;
  setupFor?: Me | null;
}) {
  const { t } = useTranslation();
  const step = useSetupStep(setupFor ?? null);
  return (
    <div className="ims auth">
      <aside className="auth-panel" data-testid="auth-panel">
        {/* `lazy`: ≤720px mảng này bị ẩn, điện thoại không phải tải ảnh nền về. */}
        <picture className="auth-photo">
          <source srcSet="/brand/login-photo.webp" type="image/webp" />
          <img
            src="/brand/login-photo.jpg"
            width={1200}
            height={628}
            alt=""
            decoding="async"
            loading="lazy"
          />
        </picture>
        <div className="auth-panel-body">
          <BrandLogo alt={t('auth.panelOrg')} className="auth-panel-logo" lazy />
          <p className="auth-panel-system">{t('auth.panelSystem')}</p>
          <ul className="auth-panel-points">
            <li>{t('auth.panelPoint1')}</li>
            <li>{t('auth.panelPoint2')}</li>
            <li>{t('auth.panelPoint3')}</li>
          </ul>
        </div>
      </aside>
      <div className="auth-main">
        <section className="auth-card">
          <div className="auth-logo">
            <BrandEmblem alt={t('auth.panelOrg')} className="auth-emblem" lazy />
            {/* Tên đầy đủ + công ty: người mở link từ thư cần chắc đây là trang thật của PMH. */}
            <span className="auth-brand">
              <span>{t('app.brand')}</span>
              <span className="auth-brand-sub">{t('app.brandFull')}</span>
            </span>
          </div>
          {step ? (
            <div className="auth-steps" data-testid="auth-steps">
              <div className="auth-steps-bar" aria-hidden="true">
                {Array.from({ length: step.total }, (_, i) => (
                  <span key={i} className={i < step.current ? 'on' : undefined} />
                ))}
              </div>
              <p className="auth-steps-text">
                {t('auth.stepOf', { current: step.current, total: step.total, label: t(step.label) })}
              </p>
            </div>
          ) : null}
          <div>
            <h1 className="auth-title">{title}</h1>
            {signedInAs ? (
              <p className="auth-sub" data-testid="auth-signed-in-as">
                {t('auth.signingInAs')} <strong className="auth-account">{signedInAs.email}</strong>
              </p>
            ) : null}
            {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
          </div>
          {notice ? (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <div
              id={AUTH_ERROR_ID}
              className={errorTone === 'danger' ? 'auth-error' : `auth-error ${errorTone}`}
              role="alert"
            >
              {error}
            </div>
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
    </div>
  );
}

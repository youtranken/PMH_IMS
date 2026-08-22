import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { visibleGroups } from '@/shell/app-nav';
import { NavIcon } from '@/ui/nav-icon';
import { ThemeSwitch } from '@/ui/switches';

/**
 * Khung ứng dụng dùng chung (AD-15/UX-DR1): sidebar + topbar. Mọi màn nghiệp vụ
 * render vào giữa và KHÔNG tự dựng layout riêng.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = visibleGroups(me);

  const logout = useApiMutation<undefined, { status: string }>('/api/v1/auth/logout', {
    csrfToken: me.csrfToken,
  });

  return (
    <div className="ims shell-root">
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              IMS
            </span>
            <span>{t('app.brand')}</span>
          </div>

          {groups.map((group) => (
            <div key={group.labelKey}>
              <p className="nav-label">{t(group.labelKey)}</p>
              {group.items.map((item) =>
                item.planned ? (
                  <span
                    key={item.key}
                    className="nav-item is-planned"
                    aria-disabled="true"
                    title="Màn hình thuộc epic sau"
                  >
                    <NavIcon navKey={item.key} />
                    <span className="lbl">{t(item.key)}</span>
                  </span>
                ) : (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    end={item.to === '/'}
                  >
                    <NavIcon navKey={item.key} />
                    <span className="lbl">{t(item.key)}</span>
                  </NavLink>
                ),
              )}
            </div>
          ))}

          <div className="sb-foot">
            <div className="sb-user">
              <span className="sb-av" aria-hidden="true">
                {initials(me.fullName)}
              </span>
              <span className="sb-who">
                <b>{me.fullName}</b>
                <span>{roleLabel(me.role, t)}</span>
              </span>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate(undefined, { onSuccess: () => navigate('/dang-nhap') });
              }}
            >
              {t('common.logout')}
            </button>
          </div>
        </aside>

        <div className="content">
          <header className="topbar">
            <span className="hello">
              {t('app.brandFull')} — <strong>{me.fullName}</strong>
            </span>
            <span className="spacer" />
            <ThemeSwitch />
          </header>
          <main className="page">{children}</main>
        </div>
      </div>
    </div>
  );
}

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function roleLabel(role: Me['role'], t: (key: string) => string): string {
  return t(
    role === 'sa' ? 'accounts.roleSa' : role === 'admin' ? 'accounts.roleAdmin' : 'accounts.roleMember',
  );
}

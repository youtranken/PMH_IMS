import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/lib/api';
import { LOGIN_PATH, type Me } from '@/lib/me';
import { visibleGroups } from '@/shell/app-nav';
import { NavIcon } from '@/ui/nav-icon';
import { ThemeSwitch } from '@/ui/switches';

/**
 * Ngưỡng "màn hẹp" — PHẢI khớp `@media (max-width: 900px)` trong css/shell.css. Lệch một
 * pixel là có vùng viewport mà JS nghĩ rộng còn CSS nghĩ hẹp (hoặc ngược lại).
 */
const NARROW_QUERY = '(max-width: 900px)';

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/**
 * Khung ứng dụng dùng chung (AD-15/UX-DR1): sidebar + topbar. Mọi màn nghiệp vụ
 * render vào giữa và KHÔNG tự dựng layout riêng.
 *
 * Ở màn hẹp (≤900px) sidebar 236px sẽ ăn 60% bề ngang điện thoại, chỉ chừa ~154px cho nội
 * dung — không màn ĐỌC nào dùng được (UX-DR2). Nên ở đó sidebar chuyển thành DRAWER: mặc
 * định không có mặt, mở bằng nút trong topbar, đóng bằng backdrop / Esc / vừa chọn xong một
 * mục. Desktop giữ nguyên hành vi cũ.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = visibleGroups(me);
  const narrow = useIsNarrow();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showSidebar = !narrow || drawerOpen;

  // Chọn xong một mục thì drawer phải tự khép, không che mất trang vừa mở.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Esc là đường thoát mà người dùng bàn phím luôn thử trước.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const logout = useApiMutation<undefined, { status: string }>('/api/v1/auth/logout', {
    csrfToken: me.csrfToken,
  });

  return (
    <div className="ims shell-root">
      {/* Tên lớp PHẢI là `app-shell` — đây là lớp duy nhất có `display:flex` (base.css).
          Đặt sai tên → sidebar và .content xếp chồng theo chiều dọc, .content bị đẩy
          xuống dưới 100vh của sidebar nên "bên phải trống trơn ở mọi trang". */}
      <div className="app-shell">
        {narrow && drawerOpen ? (
          // Bấm ra ngoài để đóng — nút mở đang bị chính drawer che.
          <div
            className="drawer-backdrop"
            data-testid="drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        {/*
          `<nav>` chứ không phải `<aside>` (09/09). Khối này KHÔNG phải nội dung phụ trợ — nó
          là điều hướng chính của cả ứng dụng, nên `role="navigation"` mới đúng, và trình đọc
          màn hình mới nhảy thẳng tới được bằng phím tắt landmark. Kèm theo, bộ E2E hết phải
          bám vào selector CSS `aside.sidebar` (CLAUDE.md cấm) — `getByRole('navigation')` là
          tên trợ năng THẬT, đổi class không làm hỏng bài kiểm.
        */}
        {showSidebar ? (
        <nav
          className={narrow ? 'sidebar is-drawer' : 'sidebar'}
          aria-label={t('app.mainNav')}
        >
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
                    title={t('nav.plannedHint')}
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
                    // Bấm lại đúng mục đang mở thì `pathname` không đổi → phải tự đóng ở đây.
                    onClick={() => setDrawerOpen(false)}
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
                logout.mutate(undefined, { onSuccess: () => navigate(LOGIN_PATH) });
              }}
            >
              {t('common.logout')}
            </button>
          </div>
        </nav>
        ) : null}

        <div className="content">
          {/* `banner` là landmark có sẵn của `<header>` khi nó không nằm trong main/article —
              đủ để E2E bám vào mà không cần selector CSS. */}
          <header className="topbar">
            {narrow ? (
              <button
                type="button"
                className="nav-toggle"
                aria-label={t(drawerOpen ? 'app.closeNav' : 'app.openNav')}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            ) : null}
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

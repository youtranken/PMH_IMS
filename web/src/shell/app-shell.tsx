import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { type Me } from '@/lib/me';
import { ErrorBoundary } from '@/ui/error-boundary';
import { visibleGroups } from '@/shell/app-nav';
import { usePendingApprovalCount } from '@/shell/use-pending-approvals';
import { useOverdueExpiryCount } from '@/shell/use-overdue-count';
import { NavIcon } from '@/ui/nav-icon';
import { CommandPalette, openCommandPalette } from '@/ui/command-palette';
import { ThemeSwitch } from '@/ui/switches';
import { useFocusTrap } from '@/ui/focus-trap';
import { useIsNarrow } from '@/ui/use-narrow';
import { AccountMenu } from '@/shell/account-menu';

/** Câu "N yêu cầu chờ duyệt" dùng chung cho mục menu và nút mở menu (aria-describedby). */
const PENDING_APPROVALS_ID = 'nav-pending-approvals';
/** Câu "N mục đã quá hạn" của mục Sắp hết hạn. */
const OVERDUE_ID = 'nav-overdue';

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
  const groups = visibleGroups(me);
  const narrow = useIsNarrow();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const showSidebar = !narrow || drawerOpen;
  /*
   * Bẫy tiêu điểm CHỈ bật ở màn hẹp khi drawer đang mở (F-06, vế 4).
   *
   * Desktop thì sidebar là một phần của trang, không phải lớp phủ — khoá tiêu điểm vào đó là
   * dựng một cái bẫy cho người không hề yêu cầu mở gì.
   */
  const drawerRef = useFocusTrap<HTMLDivElement>(narrow && drawerOpen);
  const pendingApprovals = usePendingApprovalCount(me);
  const overdue = useOverdueExpiryCount();

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

  return (
    <div className="ims shell-root">
      {/*
        BỎ QUA NAV → NỘI DUNG (WCAG 2.4.1).
        `css/base.css` có sẵn luật `.skip-link` từ lâu — ẩn off-screen, hiện ra khi Tab tới —
        nhưng tới 18/09/2026 KHÔNG component nào render nó, nên luật ấy là CSS chết và người
        dùng bàn phím phải Tab qua trọn sidebar (7 nhóm điều hướng) ở MỖI lần đổi trang.
        Phải là phần tử ĐẦU TIÊN trong cây để nó là điểm dừng Tab đầu tiên.
      */}
      <a className="skip-link" href="#noi-dung">
        {t('app.skipToContent')}
      </a>
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
        <DrawerShell narrow={narrow} label={t('app.mainNav')} trapRef={drawerRef}>
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
                  /*
                   * CHỮ thường, không phải điều khiển: không có vai trò nào để `aria-disabled`
                   * bám vào (trên một <span> trần nó là ARIA sai, trình đọc màn hình bỏ qua), và
                   * nó cũng không được là link — bấm vào là rơi xuống 404. Lời giải thích nằm
                   * trong chữ (`sr-only`) để trình đọc màn hình đọc được; `title` còn lại cho
                   * người rê chuột.
                   */
                  <span
                    key={item.key}
                    className="nav-item is-planned"
                    title={t('nav.plannedHint')}
                  >
                    <NavIcon navKey={item.key} />
                    <span className="lbl">{t(item.key)}</span>
                    <span className="sr-only">{t('nav.plannedHint')}</span>
                  </span>
                ) : (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                    end={item.to === '/'}
                    aria-describedby={
                      item.badge === 'approvals' && pendingApprovals > 0
                        ? PENDING_APPROVALS_ID
                        : item.badge === 'overdue' && overdue > 0
                          ? OVERDUE_ID
                          : undefined
                    }
                    // Bấm lại đúng mục đang mở thì `pathname` không đổi → phải tự đóng ở đây.
                    onClick={() => setDrawerOpen(false)}
                  >
                    <NavIcon navKey={item.key} />
                    <span className="lbl">{t(item.key)}</span>
                    {item.badge === 'approvals' && pendingApprovals > 0 ? (
                      /* Số chỉ là hình; câu đầy đủ đi qua `aria-describedby` để TÊN link vẫn
                         là "Duyệt yêu cầu" — trình đọc màn hình đọc thêm số việc sau đó. */
                      <span className="nav-badge warn" aria-hidden="true">
                        {pendingApprovals}
                      </span>
                    ) : null}
                    {item.badge === 'overdue' && overdue > 0 ? (
                      /* Màu thường, không cam: cam dành cho việc đang chờ một người QUYẾT. */
                      <span className="nav-badge" aria-hidden="true">
                        {overdue}
                      </span>
                    ) : null}
                  </NavLink>
                ),
              )}
            </div>
          ))}

          <div className="sb-foot">
            <AccountMenu
              me={me}
              initials={initials(me.fullName)}
              roleLabel={roleLabel(me.role, t)}
            />
          </div>
        </nav>
        </DrawerShell>
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
                aria-describedby={pendingApprovals > 0 ? PENDING_APPROVALS_ID : undefined}
                onClick={() => setDrawerOpen((open) => !open)}
              >
                {/* Menu đóng trên điện thoại thì badge nằm khuất — chấm cam trên nút mở là tín
                    hiệu duy nhất người duyệt thấy khi mở app. */}
                {pendingApprovals > 0 ? <span className="nav-toggle-dot" aria-hidden="true" /> : null}
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
            {/*
              ĐƯỜNG VÀO THẤY ĐƯỢC CHO ⌘K (18/09/2026).
              Trước đó hộp tìm nhanh chỉ mở bằng phím tắt: trên điện thoại (UX-DR2) nó KHÔNG
              tồn tại, còn với người dùng chuột thì không có gì trên màn hình nói là nó có.
              Gợi ý phím tắt nằm trong nhãn trợ năng để người đi bàn phím học được đường tắt.
            */}
            <button
              type="button"
              className="nav-toggle"
              aria-label={t('palette.openHint')}
              onClick={openCommandPalette}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
            <ThemeSwitch />
          </header>
          {/* ⌘K — nằm ở shell nên bấm được từ BẤT KỲ màn nào, không phải chỉ màn danh sách. */}
          <CommandPalette me={me} />
          {pendingApprovals > 0 ? (
            <span id={PENDING_APPROVALS_ID} className="sr-only">
              {t('approvals.navBadge', { count: pendingApprovals })}
            </span>
          ) : null}
          {overdue > 0 ? (
            <span id={OVERDUE_ID} className="sr-only">
              {t('expiry.navBadge', { count: overdue })}
            </span>
          ) : null}
          {/*
            `inert` khi drawer đang mở ở màn hẹp (F-06, vế 4) — nội dung trang thôi nhận chuột,
            tiêu điểm và trình đọc màn hình.

            Chỉ `<main>`, KHÔNG phải cả `.content`: nút đóng drawer nằm trong topbar, và topbar
            là con của `.content`. Làm cả khối `inert` là khoá luôn chính cái nút để thoát ra —
            và cả chỗ mà bẫy tiêu điểm sẽ trả tiêu điểm về.

            Đây là lớp thứ BA, không phải lớp duy nhất: bẫy tiêu điểm lo bàn phím, backdrop lo
            chuột, `aria-modal` lo con trỏ ảo của trình đọc màn hình. `inert` để ba lớp ấy
            không phải lớp nào cũng đúng tuyệt đối thì mới an toàn.
          */}
          {/*
            `data-testid` vì bài kiểm KHÔNG bám được vào vai `main` ở đây: `inert` gỡ phần tử
            khỏi CÂY TRỢ NĂNG, nên đúng lúc cần khẳng định "nội dung đang inert" thì
            `getByRole('main')` không còn tìm thấy gì. Đó cũng chính là bằng chứng `inert` đang
            làm việc — nhưng một khẳng định không phân biệt được "đã inert" với "không tồn tại"
            thì không khẳng định được gì.
          */}
          <main
            className="page"
            id="noi-dung"
            data-testid="page-main"
            tabIndex={-1}
            inert={narrow && drawerOpen}
          >
            {/* Một màn hỏng lúc render chỉ thay chính nó bằng khối báo lỗi; sidebar vẫn dùng được,
                và bấm sang màn khác (pathname đổi) là thoát (FE-01). */}
            <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * Lớp bọc biến sidebar thành một HỘP THOẠI ở màn hẹp — và chỉ ở màn hẹp (F-06, vế 4).
 *
 * ===== VÌ SAO BỌC NGOÀI, KHÔNG ĐẶT `role="dialog"` LÊN CHÍNH `<nav>` =====
 *
 * Đặt lên `<nav>` là XOÁ landmark điều hướng: `role` ghi đè vai mặc định, nên trình đọc màn
 * hình mất đường nhảy thẳng tới menu bằng phím tắt landmark — đúng thứ quyết định 09/09 dựng
 * ra khi đổi `<aside>` thành `<nav>`. Và `getByRole('navigation', { name: 'Điều hướng chính' })`
 * của bộ E2E sẽ không còn khớp ở màn hẹp, tức một bản vá trợ năng làm hỏng bài kiểm trợ năng.
 *
 * Bọc ngoài thì cả hai cùng đúng: AT thấy một hộp thoại chứa MỘT landmark điều hướng.
 *
 * ===== LỚP BỌC PHẢI CÓ KÍCH THƯỚC THẬT (sửa 24/09) =====
 *
 * Bản đầu để `<div>` trần và giữ `position:fixed` ở `.sidebar.is-drawer`. Con ra khỏi luồng,
 * nên lớp bọc thành một flex-item RỘNG 0 — tức chính cái hộp thoại không có kích thước.
 * Playwright đọc ra `hidden` và bài đỏ; đáng lo hơn bài đỏ là chuyện một phần tử không kích
 * thước thì mọi phép đo "có nhìn thấy không" đều có quyền bỏ qua nó.
 *
 * Nay `.drawer-dialog` giữ phần ĐỊNH VỊ, `.sidebar.is-drawer` giữ phần HÌNH THỨC. Cái đeo
 * `role="dialog"` là cái có kích thước thật.
 *
 * KHÔNG dùng `display:contents` để "cho lớp bọc biến mất": một số trình duyệt từng gỡ luôn
 * phần tử ấy khỏi cây trợ năng, tức mất đúng cái `role="dialog"` vừa thêm.
 */
function DrawerShell({
  narrow,
  label,
  trapRef,
  children,
}: {
  narrow: boolean;
  label: string;
  trapRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  if (!narrow) return <>{children}</>;
  return (
    <div
      ref={trapRef}
      className="drawer-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      /* Nhận được tiêu điểm bằng mã khi drawer rỗng, nhưng KHÔNG nằm trong vòng Tab. */
      tabIndex={-1}
    >
      {children}
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

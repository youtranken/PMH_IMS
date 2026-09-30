import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';
import { type Me } from '@/lib/me';
import { ErrorBoundary } from '@/ui/error-boundary';
import { groupOfPath, visibleGroups, type NavGroup } from '@/shell/app-nav';
import { usePendingApprovalCount } from '@/shell/use-pending-approvals';
import { useOverdueExpiryCount } from '@/shell/use-overdue-count';
import { NavIcon } from '@/ui/nav-icon';
import { CommandPalette, openCommandPalette, paletteShortcut } from '@/ui/command-palette';
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
   * Bẫy tiêu điểm CHỈ bật ở màn hẹp khi drawer đang mở.
   *
   * Desktop thì sidebar là một phần của trang, không phải lớp phủ — khoá tiêu điểm vào đó là
   * dựng một cái bẫy cho người không hề yêu cầu mở gì.
   */
  const drawerRef = useFocusTrap<HTMLDivElement>(narrow && drawerOpen);
  const pendingApprovals = usePendingApprovalCount(me);
  const overdue = useOverdueExpiryCount();
  const [shortcut] = useState(paletteShortcut);

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
        Luật `.skip-link` ở `css/base.css` — ẩn off-screen, hiện ra khi Tab tới. Không có nó
        thì người dùng bàn phím phải Tab qua trọn sidebar ở MỖI lần đổi trang.
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
          `<nav>` chứ không phải `<aside>`. Khối này KHÔNG phải nội dung phụ trợ — nó
          là điều hướng chính của cả ứng dụng, nên `role="navigation"` mới đúng, và trình đọc
          màn hình mới nhảy thẳng tới được bằng phím tắt landmark. Kèm theo, bộ E2E không phải
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
            {narrow ? (
              /* Nút đóng NGAY TRONG drawer: không thì người dùng phải đoán là chạm vào dải mờ.
                 Tên "Đóng", không trùng "Đóng menu" của nút ở topbar. */
              <button
                type="button"
                className="icon-btn drawer-close"
                aria-label={t('common.close')}
                onClick={() => setDrawerOpen(false)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ) : null}
          </div>

          {narrow ? (
            /* Khi drawer mở, nút tìm trên topbar nằm dưới lớp mờ — đưa lối vào Tìm nhanh vào đây.
               Đóng drawer TRƯỚC rồi mới mở hộp: hai lớp phủ cùng giữ tiêu điểm thì giằng nhau. */
            <button
              type="button"
              className="sb-search"
              onClick={() => {
                setDrawerOpen(false);
                window.setTimeout(openCommandPalette, 0);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <span>{t('palette.title')}</span>
            </button>
          ) : null}

          {/* Vùng cuộn RIÊNG cho danh sách mục: menu dài hơn màn laptop thì chỉ phần này cuộn,
              khối tài khoản ở đáy luôn đứng yên và có mép mờ báo còn mục bên dưới. */}
          <div className="sb-scroll">
          {groups.map((group) => (
            <NavSection key={group.labelKey} group={group} pathname={pathname}>
              {group.items.map((item) => (
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
                  <span className="lbl">
                    {t(me.role === 'member' && item.memberKey ? item.memberKey : item.key)}
                  </span>
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
              ))}
            </NavSection>
          ))}
          </div>

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
                className="icon-btn nav-toggle"
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
            {/*
              Tên NHÓM, không phải tên màn: tên màn đã là `<h1>` của chính trang, topbar nhắc lại
              là người dùng đọc cùng một chữ hai lần ngay đầu màn (Q-18). Nhóm là ngữ cảnh mà
              `<h1>` không nói — nhất là trên điện thoại, nơi menu đang khép.
            */}
            <GroupContext groups={groups} pathname={pathname} />
            <span className="spacer" />
            {/*
              ĐƯỜNG VÀO THẤY ĐƯỢC CHO TÌM NHANH. Desktop: trông như một ô nhập kèm phím tắt đúng
              nền tảng (⌘K trên Mac) — người dùng chuột học được phím tắt từ chính nó. Điện thoại:
              nút icon 44×44.
            */}
            {narrow ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('palette.openHint', { keys: shortcut })}
                onClick={openCommandPalette}
              >
                <SearchIcon />
              </button>
            ) : (
              <button
                type="button"
                className="topbar-search"
                aria-label={t('palette.openHint', { keys: shortcut })}
                onClick={openCommandPalette}
              >
                <SearchIcon />
                <span className="topbar-search-ph" aria-hidden="true">
                  {t('palette.placeholder')}
                </span>
                <kbd aria-hidden="true">{shortcut}</kbd>
              </button>
            )}
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
            `inert` khi drawer đang mở ở màn hẹp — nội dung trang thôi nhận chuột,
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
 * Lớp bọc biến sidebar thành một HỘP THOẠI ở màn hẹp — và chỉ ở màn hẹp.
 *
 * ===== VÌ SAO BỌC NGOÀI, KHÔNG ĐẶT `role="dialog"` LÊN CHÍNH `<nav>` =====
 *
 * Đặt lên `<nav>` là XOÁ landmark điều hướng: `role` ghi đè vai mặc định, nên trình đọc màn
 * hình mất đường nhảy thẳng tới menu bằng phím tắt landmark — đúng lý do menu là `<nav>` chứ
 * không phải `<aside>`. Và `getByRole('navigation', { name: 'Điều hướng chính' })`
 * của bộ E2E sẽ không còn khớp ở màn hẹp, tức một bản vá trợ năng làm hỏng bài kiểm trợ năng.
 *
 * Bọc ngoài thì cả hai cùng đúng: AT thấy một hộp thoại chứa MỘT landmark điều hướng.
 *
 * ===== LỚP BỌC PHẢI CÓ KÍCH THƯỚC THẬT =====
 *
 * Để `<div>` trần và giữ `position:fixed` ở `.sidebar.is-drawer` thì con ra khỏi luồng,
 * nên lớp bọc thành một flex-item RỘNG 0 — tức chính cái hộp thoại không có kích thước.
 * Playwright đọc ra `hidden` và bài đỏ; đáng lo hơn bài đỏ là chuyện một phần tử không kích
 * thước thì mọi phép đo "có nhìn thấy không" đều có quyền bỏ qua nó.
 *
 * Nên `.drawer-dialog` giữ phần ĐỊNH VỊ, `.sidebar.is-drawer` giữ phần HÌNH THỨC. Cái đeo
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

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Khoá nhớ nhóm nào người dùng đã tự mở — theo từng máy, không phải dữ liệu cần giữ lâu. */
const NAV_OPEN_PREFIX = 'ims_nav_open:';

/*
 * localStorage có thể ném lỗi (trình duyệt chặn dữ liệu trang, cửa sổ riêng tư): lúc đó menu
 * vẫn phải dựng, chỉ mất phần "nhớ".
 */
function readGroupOpen(labelKey: string): boolean {
  try {
    return window.localStorage.getItem(NAV_OPEN_PREFIX + labelKey) === '1';
  } catch {
    return false;
  }
}

function writeGroupOpen(labelKey: string, open: boolean): void {
  try {
    if (open) window.localStorage.setItem(NAV_OPEN_PREFIX + labelKey, '1');
    else window.localStorage.removeItem(NAV_OPEN_PREFIX + labelKey);
  } catch {
    /* Không nhớ được thì thôi — lần sau nhóm khép như mặc định. */
  }
}

/**
 * Một nhóm trên menu. Nhóm `collapsible` có tiêu đề là nút khép/mở (Q-18).
 *
 * Đang đứng ở một màn TRONG nhóm thì nhóm tự mở: mục đang chọn mà nằm khuất sau một nhóm khép
 * thì người dùng mất dấu mình đang ở đâu. Lần tự mở ấy không ghi vào localStorage — chỉ lựa
 * chọn chính tay người dùng mới được nhớ.
 *
 * Vùng mục dùng `hidden` chứ không gỡ khỏi cây: `aria-controls` phải trỏ vào một phần tử có
 * thật.
 */
function NavSection({
  group,
  pathname,
  children,
}: {
  group: NavGroup;
  pathname: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const holdsRoute = groupOfPath([group], pathname) !== null;
  const [open, setOpen] = useState(() => holdsRoute || readGroupOpen(group.labelKey));

  useEffect(() => {
    if (holdsRoute) setOpen(true);
  }, [holdsRoute, pathname]);

  if (!group.collapsible) {
    return (
      <div>
        <p className="nav-label">{t(group.labelKey)}</p>
        {children}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="nav-label nav-group-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          writeGroupOpen(group.labelKey, next);
        }}
      >
        <span>{t(group.labelKey)}</span>
        <svg
          className="nav-group-chev"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function GroupContext({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  const { t } = useTranslation();
  const group = groupOfPath(groups, pathname);
  return (
    <span className="topbar-context" data-testid="topbar-context">
      {group ? t(group.labelKey) : null}
    </span>
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

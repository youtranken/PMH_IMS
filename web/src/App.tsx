import {
  Navigate,
  Route,
  RouterProvider,
  Routes,
  createBrowserRouter,
  useLocation,
  useParams,
} from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/lib/api';
import {
  clearNextPath,
  noteTabOwner,
  peekNextPath,
  rememberNextPath,
  tabOwner,
} from '@/lib/next-path';
import {
  CHANGE_PASSWORD_PATH,
  LEGACY_AUTH_ROUTES,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  nextStepPath,
} from '@/lib/me';
import { LEGACY_ROUTES, PATHS, ROUTE_ROLES, canSeeRoute } from '@/lib/routes';
import { AppShell } from '@/shell/app-shell';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { Forbidden, LoadError, Loading, NotFound } from '@/ui/load-state';
import { ToastProvider } from '@/ui/toast';
import { AccountsScreen } from '@/features/admin/accounts-screen';
import { AuditLogScreen } from '@/features/admin/audit-log-screen';
import { CatalogScreen } from '@/features/catalog/catalog-screen';
import { DeviceDetail } from '@/features/devices/device-detail';
import { DevicesScreen } from '@/features/devices/devices-screen';
import { ExpiryScreen } from '@/features/expiry/expiry-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { AccessMatrixScreen } from '@/features/vault/access-matrix-screen';
import { SettingsScreen } from '@/features/admin/settings-screen';
import { ApprovalsScreen } from '@/features/vault/approvals-screen';
import { ApprovalDetailScreen } from '@/features/vault/approval-detail-screen';
import { DisposalScreen } from '@/features/disposal/disposal-screen';
import { VaultHomeScreen } from '@/features/vault/vault-home-screen';
import { NatScreen } from '@/features/ipam/nat-screen';
import { ServiceAccountDetail } from '@/features/service-accounts/service-account-detail';
import { ServiceAccountsScreen } from '@/features/service-accounts/service-accounts-screen';
import { IpamScreen } from '@/features/ipam/ipam-screen';
import { IspDetail } from '@/features/isp/isp-detail';
import { IspScreen } from '@/features/isp/isp-screen';
import { SoftwareDetail } from '@/features/software/software-detail';
import { SoftwareScreen } from '@/features/software/software-screen';
import { ChangePassword } from '@/features/auth/change-password';
import { AuthCard } from '@/features/auth/auth-card';
import { LoginScreen } from '@/features/auth/login-screen';
import { ProfileScreen } from '@/features/auth/profile-screen';
import { TotpChallenge } from '@/features/auth/totp-challenge';
import { TotpEnroll } from '@/features/auth/totp-enroll';
import { ComponentsGallery } from '@/features/dev/components-gallery';
import { DEV_KIT_ENABLED } from '@/lib/dev-kit';
import { usePageTitle } from '@/ui/use-page-title';
import { LiveRegion } from '@/ui/live-region';

/**
 * Data router chứ không `BrowserRouter`: `useBlocker` (chặn rời màn khi còn thay đổi chưa lưu,
 * `ui/use-unsaved-guard`) chỉ chạy dưới data router. Cả cây route vẫn là `<Routes>` lồng bên
 * trong một route `*` duy nhất, nên luồng đăng nhập ở `AppRoutes` giữ nguyên.
 *
 * Tạo router theo từng lần gắn `App`, không ở cấp module: router đọc `window.location` lúc tạo,
 * và bài kiểm gắn `App` nhiều lần với địa chỉ khác nhau.
 */
export default function App() {
  const [router] = useState(() => createBrowserRouter([{ path: '*', element: <AppRoot /> }]));
  return <RouterProvider router={router} />;
}

function AppRoot() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        {/*
          Vùng sống thường trực, gắn NGOÀI `AppRoutes`. Phải nằm ngoài vì `AppRoutes`
          tự `return <Loading/>` trong lúc hỏi `/auth/me`: đặt bên trong thì đúng lượt tải
          đầu tiên — lượt duy nhất người dùng chắc chắn phải chờ — lại không có vùng sống
          nào đang đứng sẵn để loan báo.
        */}
        <LiveRegion />
        <AppRoutes />
      </ConfirmProvider>
    </ToastProvider>
  );
}

/**
 * Chuyển hướng đường cũ sang đường mới, GIỮ NGUYÊN query và hash.
 *
 * Có deep-link `?tab=vault`, nên một link đã ghim
 * `/thiet-bi/<id>?tab=vault` mà rơi mất query sẽ mở ra tab Hồ sơ — người bấm không hiểu vì
 * sao nó không vào thẳng két như mọi khi.
 */
function LegacyRedirect({ to, withId }: { to: string; withId?: boolean }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const path = withId ? `${to}/${id}` : to;
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />;
}

/**
 * Xong luồng đăng nhập: đi tới đích đã nhớ (đã kiểm là đường nội bộ, và thuộc đúng người vừa
 * đăng nhập) rồi xoá nó, để lần đăng nhập sau không bị kéo về một trang cũ.
 */
function ResumeAfterLogin({ email }: { email: string }) {
  const [target] = useState(() => peekNextPath(email) ?? '/');
  useEffect(() => clearNextPath(), []);
  return <Navigate to={target} replace />;
}

function AppRoutes() {
  const { t } = useTranslation();
  const { data: me, isLoading, isError, error, refetch } = useMe();
  const location = useLocation();
  /* Ghi chủ của tab lúc render là an toàn: cùng một giá trị, ghi lại bao nhiêu lần cũng vậy. */
  if (me) noteTabOwner(me.email);
  /*
   * Gọi ở ĐÂY, trước mọi lượt `return` sớm, vì hai lý do:
   *
   *   1. luật hook — `usePageTitle` phải chạy ở mọi lượt render của component này;
   *   2. nó phủ luôn màn đăng nhập và trang 404, tức những màn KHÔNG nằm trong shell. Đặt
   *      trong `app-shell.tsx` thì đăng xuất xong tab vẫn đội tên màn cuối cùng vừa xem —
   *      một cái tên nói rằng người dùng vẫn đang ở trong đó.
   */
  usePageTitle();
  if (isLoading) return <Loading />;

  /*
   * `/auth/me` hỏng (502 lúc API khởi động lại, mất mạng) KHÔNG phải "chưa đăng nhập" — 401
   * đã được `useMe` đổi thành `null` rồi. Coi lỗi là chưa đăng nhập thì người có phiên hợp lệ
   * bị đẩy về màn đăng nhập, và nếu API chưa lên thì màn đó cũng hỏng nốt. Chỉ chặn khi CHƯA
   * có dữ liệu: lượt hỏi lại nền hỏng mà đã biết phiên thì cứ dùng bản đã biết.
   */
  if (isError && me === undefined) {
    return (
      <AuthCard title={t('app.sessionCheckFailed')}>
        <LoadError error={error} onRetry={() => void refetch()} />
      </AuthCard>
    );
  }

  const step = nextStepPath(me ?? null);
  /*
   * Kể cả đường TIẾNG VIỆT cũ: người đã đăng nhập mở một link `/dang-nhap` đã ghim thì phải
   * được đưa về trang chủ như trước khi đổi đường dẫn. Không kể vào đây thì nó rơi xuống
   * `Routes` của shell, không khớp gì và ra trang 404 — một hồi quy do chính lần đổi đường
   * dẫn gây ra.
   */
  const isAuthRoute = [
    LOGIN_PATH,
    TOTP_CHALLENGE_PATH,
    TOTP_ENROLL_PATH,
    CHANGE_PASSWORD_PATH,
    ...LEGACY_AUTH_ROUTES.map((route) => route.from),
  ].includes(location.pathname);

  // Người dùng chưa đi hết luồng đăng nhập: luôn đưa về ĐÚNG bước còn thiếu.
  // Đây là nơi DUY NHẤT quyết định điều hướng đăng nhập — màn không tự navigate (AD-15).
  if (step !== '/' && location.pathname !== step) {
    // Nhớ nơi người dùng định mở (link trong mail duyệt break-glass…) để đưa về đúng đó sau
    // khi xong MỌI bước. Ghi lúc render là an toàn: cùng một giá trị, ghi lại bao nhiêu lần cũng vậy.
    if (!isAuthRoute) {
      rememberNextPath(
        `${location.pathname}${location.search}${location.hash}`,
        me?.email ?? tabOwner(),
      );
    }
    return <Navigate to={step} replace />;
  }
  // Đã đủ điều kiện mà còn nằm ở màn đăng nhập → vào app, về đúng đích đã nhớ nếu có.
  if (step === '/' && isAuthRoute) {
    return <ResumeAfterLogin email={me?.email ?? ''} />;
  }

  if (!me) {
    return (
      <Routes>
        <Route path={LOGIN_PATH} element={<LoginScreen />} />
        {/* Link đăng nhập tiếng Việt đã ghim: đưa sang đúng đường mới thay vì để `*` gom hết
            về màn đăng nhập — người đang ở giữa luồng 2 lớp phải quay lại đúng bước của họ. */}
        {LEGACY_AUTH_ROUTES.map(({ from, to }) => (
          <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
        ))}
        <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
      </Routes>
    );
  }

  if (step !== '/') {
    return (
      <Routes>
        <Route path={TOTP_CHALLENGE_PATH} element={<TotpChallenge />} />
        <Route path={TOTP_ENROLL_PATH} element={<TotpEnroll />} />
        <Route path={CHANGE_PASSWORD_PATH} element={<ChangePassword />} />
      </Routes>
    );
  }

  return (
    <AppShell me={me}>
      <Routes>
        <Route path={PATHS.dashboard} element={<DashboardScreen me={me} />} />
        {/* Gác theo BẢNG `ROUTE_ROLES`, không bằng mấy câu `? :` rải rác: gác trong màn thì
            màn quản trị đã dựng đủ h1 + nút bấm được cho Member rồi mới từ chối. Bảng cho
            phép hỏi "có đường /admin nào chưa khai vai không", câu mà JSX không trả lời được. */}
        {canSeeRoute(PATHS.adminAccounts, me.role) ? (
          <Route path={PATHS.adminAccounts} element={<AccountsScreen me={me} />} />
        ) : (
          <Route path={PATHS.adminAccounts} element={<Forbidden roles={ROUTE_ROLES[PATHS.adminAccounts]} />} />
        )}
        {canSeeRoute(PATHS.adminCatalog, me.role) ? (
          <Route path={PATHS.adminCatalog} element={<CatalogScreen me={me} />} />
        ) : (
          <Route path={PATHS.adminCatalog} element={<Forbidden roles={ROUTE_ROLES[PATHS.adminCatalog]} />} />
        )}
        {canSeeRoute(PATHS.adminVaultAccess, me.role) ? (
          <Route path={PATHS.adminVaultAccess} element={<AccessMatrixScreen me={me} />} />
        ) : (
          <Route path={PATHS.adminVaultAccess} element={<Forbidden roles={ROUTE_ROLES[PATHS.adminVaultAccess]} />} />
        )}
        {canSeeRoute(PATHS.adminAuditLog, me.role) ? (
          <Route path={PATHS.adminAuditLog} element={<AuditLogScreen />} />
        ) : (
          <Route path={PATHS.adminAuditLog} element={<Forbidden roles={ROUTE_ROLES[PATHS.adminAuditLog]} />} />
        )}
        {canSeeRoute(PATHS.adminSettings, me.role) ? (
          <Route path={PATHS.adminSettings} element={<SettingsScreen me={me} />} />
        ) : (
          <Route path={PATHS.adminSettings} element={<Forbidden roles={ROUTE_ROLES[PATHS.adminSettings]} />} />
        )}
        <Route path={PATHS.approvals} element={<ApprovalsScreen me={me} />} />
        {/* Mọi vai: đường vào tự đổi mật khẩu / cài lại 2 lớp / đóng phiên của chính mình. */}
        <Route path={PATHS.profile} element={<ProfileScreen me={me} />} />
        {/* Đích của nút trong thư duyệt: mở MỘT phiếu và quyết ngay. Quyền đọc do API gác. */}
        <Route path={`${PATHS.approvals}/:id`} element={<ApprovalDetailScreen me={me} />} />
        {/* Gác ở CẢ route, không chỉ ẩn mục menu: gõ thẳng URL nhận trang 403 nói rõ thiếu quyền. */}
        {canSeeRoute(PATHS.vault, me.role) ? (
          <Route path={PATHS.vault} element={<VaultHomeScreen me={me} />} />
        ) : (
          <Route path={PATHS.vault} element={<Forbidden roles={ROUTE_ROLES[PATHS.vault]} />} />
        )}
        {/* Kho thanh lý mở cho MỌI vai — khác trang tổng Két sắt ngay trên: kho chỉ nói
            "hồ sơ nào đã ngừng dùng", không nói công ty giữ bí mật ở đâu. */}
        <Route path={PATHS.disposal} element={<DisposalScreen />} />
        <Route path={PATHS.devices} element={<DevicesScreen me={me} />} />
        <Route path={`${PATHS.devices}/:id`} element={<DeviceDetail me={me} />} />
        <Route path={PATHS.software} element={<SoftwareScreen me={me} />} />
        <Route path={`${PATHS.software}/:id`} element={<SoftwareDetail me={me} />} />
        <Route path={PATHS.ispLines} element={<IspScreen me={me} />} />
        <Route path={`${PATHS.ispLines}/:id`} element={<IspDetail me={me} />} />
        <Route path={PATHS.expiry} element={<ExpiryScreen me={me} />} />
        {/* Một màn cho cả hai đường dẫn: `/ip-addresses` mở sẵn dải đầu, `/ip-addresses/:id`
            mở đúng dải đó — mỗi dải vẫn có địa chỉ riêng để gửi cho nhau. */}
        <Route path={PATHS.ipAddresses} element={<IpamScreen me={me} />} />
        <Route path={`${PATHS.ipAddresses}/:id`} element={<IpamScreen me={me} />} />
        <Route path={PATHS.nat} element={<NatScreen me={me} />} />
        <Route path={PATHS.serviceAccounts} element={<ServiceAccountsScreen me={me} />} />
        <Route
          path={`${PATHS.serviceAccounts}/:id`}
          element={<ServiceAccountDetail me={me} />}
        />
        {/* Bộ giao diện là trang nội bộ: member/admin vào thẳng URL nhận trang 403. Bản
            production không đăng ký route nào (FE-09): cờ là hằng lúc build, nên cả nhánh lẫn
            mã trang dev bị bỏ khỏi bundle và gõ URL rơi vào 404. */}
        {DEV_KIT_ENABLED ? (
          canSeeRoute(PATHS.devComponents, me.role) ? (
            <Route path={PATHS.devComponents} element={<ComponentsGallery />} />
          ) : (
            <Route path={PATHS.devComponents} element={<Forbidden roles={ROUTE_ROLES[PATHS.devComponents]} />} />
          )
        ) : null}
        {/* Link tiếng Việt đã ghim/đã gửi cho nhau vẫn mở được, và thanh địa chỉ đổi luôn
            sang đường mới (`replace` để nút Back không kẹt giữa hai đường). */}
        {LEGACY_ROUTES.map(({ from, to, withId }) => (
          <Route key={from} path={from} element={<LegacyRedirect to={to} withId={withId} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}


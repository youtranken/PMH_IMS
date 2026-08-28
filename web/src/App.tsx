import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom';
import { useMe } from '@/lib/api';
import {
  CHANGE_PASSWORD_PATH,
  LEGACY_AUTH_ROUTES,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  nextStepPath,
} from '@/lib/me';
import { LEGACY_ROUTES, PATHS } from '@/lib/routes';
import { AppShell } from '@/shell/app-shell';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { Loading, NotFound } from '@/ui/load-state';
import { ToastProvider } from '@/ui/toast';
import { AccountsScreen } from '@/features/admin/accounts-screen';
import { CatalogScreen } from '@/features/catalog/catalog-screen';
import { DeviceDetail } from '@/features/devices/device-detail';
import { DevicesScreen } from '@/features/devices/devices-screen';
import { ExpiryScreen } from '@/features/expiry/expiry-screen';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';
import { AccessMatrixScreen } from '@/features/vault/access-matrix-screen';
import { ApprovalsScreen } from '@/features/vault/approvals-screen';
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
import { LoginScreen } from '@/features/auth/login-screen';
import { TotpChallenge } from '@/features/auth/totp-challenge';
import { TotpEnroll } from '@/features/auth/totp-enroll';
import { ComponentsGallery } from '@/features/dev/components-gallery';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AppRoutes />
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

/**
 * Chuyển hướng đường cũ sang đường mới, GIỮ NGUYÊN query và hash.
 *
 * Chính đợt này thêm deep-link `?tab=vault`, nên một link đã ghim
 * `/thiet-bi/<id>?tab=vault` mà rơi mất query sẽ mở ra tab Hồ sơ — người bấm không hiểu vì
 * sao nó không vào thẳng két như mọi khi.
 */
function LegacyRedirect({ to, withId }: { to: string; withId?: boolean }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const path = withId ? `${to}/${id}` : to;
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />;
}

function AppRoutes() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <Loading />;

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
    return <Navigate to={step} replace state={{ from: location.pathname }} />;
  }
  // Đã đủ điều kiện mà còn nằm ở màn đăng nhập → vào app.
  if (step === '/' && isAuthRoute) {
    return <Navigate to="/" replace />;
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
        <Route path={PATHS.adminAccounts} element={<AccountsScreen me={me} />} />
        <Route path={PATHS.adminCatalog} element={<CatalogScreen me={me} />} />
        <Route path={PATHS.adminVaultAccess} element={<AccessMatrixScreen me={me} />} />
        <Route path={PATHS.approvals} element={<ApprovalsScreen me={me} />} />
        {/* Gác ở CẢ route, không chỉ ẩn mục menu: gõ thẳng URL cũng chỉ nhận 404. */}
        {me.role === 'sa' || me.role === 'admin' ? (
          <Route path={PATHS.vault} element={<VaultHomeScreen me={me} />} />
        ) : null}
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
        {/* Bộ giao diện là trang nội bộ: member/admin vào thẳng URL cũng chỉ nhận 404. */}
        {me.role === 'sa' ? (
          <Route path={PATHS.devComponents} element={<ComponentsGallery />} />
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


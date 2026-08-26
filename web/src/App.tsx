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
import { VaultHomeScreen } from '@/features/vault/vault-home-screen';
import { NatScreen } from '@/features/ipam/nat-screen';
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

/** Chuyển hướng đường cũ CÓ `:id` sang đường mới, ghép lại đúng id đang đứng trên URL. */
function RedirectWithId({ to }: { to: string }) {
  const { id = '' } = useParams();
  return <Navigate to={`${to}/${id}`} replace />;
}

function AppRoutes() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <Loading />;

  const step = nextStepPath(me ?? null);
  const isAuthRoute = [LOGIN_PATH, TOTP_CHALLENGE_PATH, TOTP_ENROLL_PATH, CHANGE_PASSWORD_PATH].includes(
    location.pathname,
  );

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
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
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
        <Route path={PATHS.vault} element={<VaultHomeScreen me={me} />} />
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
        {/* Bộ giao diện là trang nội bộ: member/admin vào thẳng URL cũng chỉ nhận 404. */}
        {me.role === 'sa' ? (
          <Route path={PATHS.devComponents} element={<ComponentsGallery />} />
        ) : null}
        {/* Link tiếng Việt đã ghim/đã gửi cho nhau vẫn mở được, và thanh địa chỉ đổi luôn
            sang đường mới (`replace` để nút Back không kẹt giữa hai đường). */}
        {LEGACY_ROUTES.map(({ from, to, withId }) => (
          <Route
            key={from}
            path={from}
            element={withId ? <RedirectWithId to={to} /> : <Navigate to={to} replace />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}


import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from '@/lib/api';
import {
  CHANGE_PASSWORD_PATH,
  LOGIN_PATH,
  TOTP_CHALLENGE_PATH,
  TOTP_ENROLL_PATH,
  nextStepPath,
} from '@/lib/me';
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
import { NatScreen } from '@/features/ipam/nat-screen';
import { SubnetDetail } from '@/features/ipam/subnet-detail';
import { SubnetsScreen } from '@/features/ipam/subnets-screen';
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
        <Route path="/" element={<DashboardScreen me={me} />} />
        <Route path="/quan-tri/tai-khoan" element={<AccountsScreen me={me} />} />
        <Route path="/quan-tri/danh-muc" element={<CatalogScreen me={me} />} />
        <Route path="/quan-tri/quyen-ket-sat" element={<AccessMatrixScreen me={me} />} />
        <Route path="/duyet-yeu-cau" element={<ApprovalsScreen me={me} />} />
        <Route path="/thiet-bi" element={<DevicesScreen me={me} />} />
        <Route path="/thiet-bi/:id" element={<DeviceDetail me={me} />} />
        <Route path="/phan-mem" element={<SoftwareScreen me={me} />} />
        <Route path="/phan-mem/:id" element={<SoftwareDetail me={me} />} />
        <Route path="/duong-truyen" element={<IspScreen me={me} />} />
        <Route path="/duong-truyen/:id" element={<IspDetail me={me} />} />
        <Route path="/sap-het-han" element={<ExpiryScreen me={me} />} />
        <Route path="/dia-chi-ip" element={<SubnetsScreen me={me} />} />
        <Route path="/dia-chi-ip/:id" element={<SubnetDetail me={me} />} />
        <Route path="/so-nat" element={<NatScreen me={me} />} />
        {/* Bộ giao diện là trang nội bộ: member/admin vào thẳng URL cũng chỉ nhận 404. */}
        {me.role === 'sa' ? (
          <Route path="/dev/components" element={<ComponentsGallery />} />
        ) : null}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}


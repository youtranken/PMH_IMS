import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import type { DeviceRow } from '@/lib/device-types';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { IspScreen } from './isp/isp-screen';
import { ServiceAccountsScreen } from './service-accounts/service-accounts-screen';
import { SoftwareScreen } from './software/software-screen';
import { IpamScreen } from './ipam/ipam-screen';
import { NatScreen } from './ipam/nat-screen';
import { DigestRulesPanel } from './expiry/digest-rules-panel';
import { LicenseAssignmentsPanel } from './software/license-assignments-panel';
import type { SoftwareRow } from './software/software-types';
import { PortMapPanel } from './devices/port-map-panel';

/*
 * Khối "trống" phải chỉ đường bước tiếp: chưa khai gì thì nút Thêm (chỉ khi người xem được
 * thêm), lọc không ra thì nút Xóa bộ lọc — cùng mẫu với danh sách thiết bị.
 */

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const MEMBER = { id: 'm', role: 'member', csrfToken: 't', email: 'm@pmh.com.vn' } as unknown as Me;

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url.startsWith('/api/v1/ipam/settings')) {
        return Promise.resolve(
          jsonResponse(200, {
            subnetFullPercent: 80,
            natSensitivePorts: [22],
            subnetMinPrefix: 24,
            natWidePortRange: 1000,
          }),
        );
      }
      if (url.includes('/ports')) return Promise.resolve(jsonResponse(200, { ports: [], incoming: [] }));
      if (
        url.startsWith('/api/v1/ipam/') ||
        url.includes('/assignments') ||
        url.includes('/expiry/rules') ||
        url.includes('/vault/owners/due')
      ) {
        return Promise.resolve(jsonResponse(200, []));
      }
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string, ui: ReactElement) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** Khối trống — `.empty` là vỏ của `EmptyState`; nút trong đó là nút của khối. */
async function emptyBlock(title: string | RegExp) {
  const text = await screen.findByText(title);
  const block = text.closest('.empty');
  if (!(block instanceof HTMLElement)) throw new Error('không thấy khối trống');
  return block;
}

describe('Khối trống có nút bước tiếp', () => {
  it('Đường truyền: chưa có → nút Thêm; lọc không ra → Xóa bộ lọc', async () => {
    renderAt('/isp-lines', <IspScreen me={SA} />);
    const block = await emptyBlock('Chưa khai đường truyền nào.');
    expect(within(block).getByRole('button', { name: 'Thêm đường truyền' })).toBeInTheDocument();
  });

  it('Đường truyền đang lọc: Xóa bộ lọc, không mời Thêm', async () => {
    renderAt('/isp-lines?q=zzz', <IspScreen me={SA} />);
    const block = await emptyBlock('Không có đường truyền nào khớp bộ lọc.');
    expect(within(block).getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: 'Thêm đường truyền' })).toBeNull();
  });

  it('Tài khoản dịch vụ: SA thấy nút Thêm, Member thì không', async () => {
    const { unmount } = renderAt('/service-accounts', <ServiceAccountsScreen me={SA} />);
    const block = await emptyBlock('Chưa có tài khoản dịch vụ nào.');
    expect(within(block).getByRole('button', { name: 'Thêm tài khoản' })).toBeInTheDocument();
    unmount();
    renderAt('/service-accounts', <ServiceAccountsScreen me={MEMBER} />);
    const memberBlock = await emptyBlock('Chưa có tài khoản dịch vụ nào.');
    expect(within(memberBlock).queryByRole('button')).toBeNull();
  });

  it('Tài khoản dịch vụ đang lọc: Xóa bộ lọc', async () => {
    renderAt('/service-accounts?q=zzz', <ServiceAccountsScreen me={SA} />);
    const block = await emptyBlock('Không có tài khoản nào khớp bộ lọc.');
    expect(within(block).getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('Phần mềm: chưa có → Thêm; đang lọc → Xóa bộ lọc', async () => {
    const { unmount } = renderAt('/software', <SoftwareScreen me={SA} />);
    const block = await emptyBlock('Chưa có hồ sơ license, SSL hay tên miền nào.');
    expect(within(block).getByRole('button', { name: 'Thêm phần mềm' })).toBeInTheDocument();
    unmount();
    renderAt('/software?q=zzz', <SoftwareScreen me={SA} />);
    const filtered = await emptyBlock('Không có hồ sơ nào khớp bộ lọc.');
    expect(within(filtered).getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('Dải IP: chưa có dải → nút khai dải (chỉ SA/Admin)', async () => {
    const { unmount } = renderAt('/ipam', <IpamScreen me={SA} />);
    const block = await emptyBlock('Chưa khai dải nào');
    expect(within(block).getByRole('button', { name: 'Khai dải mới' })).toBeInTheDocument();
    unmount();
    renderAt('/ipam', <IpamScreen me={MEMBER} />);
    const memberBlock = await emptyBlock('Chưa khai dải nào');
    expect(within(memberBlock).queryByRole('button')).toBeNull();
  });

  it('Sổ NAT: chưa có → Thêm luật NAT; tìm không ra → Xóa bộ lọc', async () => {
    const { unmount } = renderAt('/nat', <NatScreen me={SA} />);
    const block = await emptyBlock('Chưa có luật NAT nào');
    expect(within(block).getByRole('button', { name: 'Thêm luật NAT' })).toBeInTheDocument();
    unmount();
    renderAt('/nat?q=zzz', <NatScreen me={SA} />);
    const filtered = await emptyBlock('Không có luật nào khớp bộ lọc.');
    expect(within(filtered).getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('Luật gửi báo cáo: SA thấy Thêm luật, Member không', async () => {
    const onAdding = vi.fn();
    const { unmount } = renderAt(
      '/expiry',
      <DigestRulesPanel me={SA} kinds={[]} adding={false} onAddingChange={onAdding} />,
    );
    const block = await emptyBlock('Chưa có luật gửi báo cáo nào.');
    await userEvent.click(within(block).getByRole('button', { name: 'Thêm luật' }));
    expect(onAdding).toHaveBeenCalledWith(true);
    unmount();
    renderAt('/expiry', <DigestRulesPanel me={MEMBER} kinds={[]} adding={false} onAddingChange={onAdding} />);
    const memberBlock = await emptyBlock('Chưa có luật gửi báo cáo nào.');
    expect(within(memberBlock).queryByRole('button')).toBeNull();
  });

  it('License chưa gán máy nào: nút Gán vào máy nằm trong khối trống, không lặp ở thanh trên', async () => {
    const software = { id: 's1', code: 'SW-E2E', kind: 'license', status: 'active' } as SoftwareRow;
    renderAt('/software/s1', <LicenseAssignmentsPanel software={software} csrfToken="t" />);
    const block = await emptyBlock('Chưa gán license này vào máy nào.');
    expect(within(block).getByRole('button', { name: 'Gán vào máy' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Gán vào máy' })).toHaveLength(1);
  });

  /* API từ chối gán vào hồ sơ đã thanh lý (SOFTWARE_RETIRED): nút ở khối trống mà vẫn hiện là
     bày ra một thao tác chắc chắn hỏng. */
  it('License đã thanh lý, chưa gán máy nào: khối trống không có nút Gán vào máy', async () => {
    const software = { id: 's1', code: 'SW-E2E', kind: 'license', status: 'retired' } as SoftwareRow;
    renderAt('/software/s1', <LicenseAssignmentsPanel software={software} csrfToken="t" />);
    const block = await emptyBlock('Chưa gán license này vào máy nào.');
    expect(within(block).queryByRole('button', { name: 'Gán vào máy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gán vào máy' })).toBeNull();
    // Sang tab đã gỡ thì nút ở thanh trên hiện lại với license còn dùng — ở đây cũng không.
    await userEvent.click(screen.getByRole('button', { name: /Đã gỡ/ }));
    expect(screen.queryByRole('button', { name: 'Gán vào máy' })).toBeNull();
  });

  it('Sơ đồ cổng trống: nút Thêm cổng nằm trong khối trống, không lặp ở thanh trên', async () => {
    const device = { id: 'd-1', code: 'SW-E2E-01', name: 'Switch', status: 'in_use' } as DeviceRow;
    renderAt('/devices/d-1', <PortMapPanel device={device} csrfToken="t" canEdit />);
    const block = await emptyBlock('Chưa khai cổng nào.');
    expect(within(block).getByRole('button', { name: 'Thêm cổng' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Thêm cổng' })).toHaveLength(1);
  });
});

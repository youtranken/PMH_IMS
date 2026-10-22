import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DeviceRow } from '@/lib/device-types';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { DeviceDetail } from './device-detail';

const ME = { id: 'u-sa', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;

export const DEVICE: DeviceRow = {
  id: 'd1', code: 'PC-E2E-01', name: 'Máy kế toán', deviceTypeId: 't1', deviceTypeName: 'Laptop', hasPortMap: false,
  model: 'Latitude 5440', serial: 'SN123', siteId: 's1', siteCode: 'HCM', cabinetId: null, cabinetCode: null,
  vendorId: 'v1', vendorName: 'Phong Vũ', assignedTo: 'Nguyễn An', department: 'Kế toán', purchaseDate: '2025-11-10',
  warrantyStart: '2025-11-10', warrantyEnd: '2027-11-15', status: 'in_use', note: null, accessPoints: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

export function renderDeviceDetail(device: DeviceRow = DEVICE) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/v1/devices/${device.id}`) return Promise.resolve(jsonResponse(200, device));
      if (url.endsWith('/timeline')) return Promise.resolve(jsonResponse(200, { items: [], failedSources: [] }));
      if (url.endsWith('/photos')) return Promise.resolve(jsonResponse(200, { device: { front: null, back: null }, model: null, effective: { front: null, back: null } }));
      if (url.endsWith('/ports')) return Promise.resolve(jsonResponse(200, { ports: [], incoming: [] }));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[`/devices/${device.id}`]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/devices/:id" element={<DeviceDetail me={ME} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Chi tiết thiết bị — mỗi thông tin nói một lần', () => {
  afterEach(() => vi.unstubAllGlobals());

  // PW-A04: Phòng ban đã là dòng phụ của ô Người dùng; Nhà cung cấp đã có thẻ riêng ở cột phải.
  it('khu Thông số không lặp Nhà cung cấp và Phòng ban', async () => {
    renderDeviceDetail();
    const spec = await screen.findByRole('group', { name: 'Thông số' });
    expect(within(spec).queryByText('Nhà cung cấp')).toBeNull();
    expect(within(spec).queryByText('Phòng ban')).toBeNull();
    expect(within(spec).getByText('Ngày mua')).toBeInTheDocument();
  });

  // PW-A27: cùng thứ tự tab với phần mềm / đường truyền / TK dịch vụ.
  it('tab: Két sắt đứng trước Giấy tờ, Lịch sử cuối', async () => {
    renderDeviceDetail();
    const tabs = (await screen.findAllByRole('tab')).map((tab) => tab.textContent ?? '');
    const at = (name: string) => tabs.findIndex((label) => label.startsWith(name));
    expect(at('Két sắt')).toBeGreaterThan(-1);
    expect(at('Két sắt')).toBeLessThan(at('Giấy tờ'));
    expect(at('Lịch sử')).toBe(tabs.length - 1);
  });
});

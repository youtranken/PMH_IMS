import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { fireEvent, jsonResponse, renderWithI18n, screen, waitFor, within } from '@/test/test-utils';
import { DevicesScreen } from './devices-screen';

/**
 * Cột bảng thiết bị (Q-27): Ảnh · Mã thiết bị · Tên gọi · IP quản trị · Vị trí · Trạng thái ·
 * Thao tác. Người dùng, Bảo hành, dòng phụ loại · model · serial đã có trong hồ sơ.
 */

const ME = { role: 'member', csrfToken: 't', email: 'm@pmh.com.vn' } as unknown as Me;

function row(id: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    id, code, name: `Máy ${code}`, deviceTypeId: 't1', deviceTypeName: 'Switch', hasPortMap: false,
    model: 'C9200', serial: 'SN-1', siteId: null, siteCode: null, cabinetId: null, cabinetCode: null,
    vendorId: null, vendorName: null, assignedTo: 'Người A', department: 'IT', purchaseDate: null,
    warrantyStart: null, warrantyEnd: '2030-01-01', status: 'in_use', note: null,
    deviceModelId: null, modelPhotoVersion: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/v1/devices?')) {
        return Promise.resolve(jsonResponse(200, {
          items: [
            row('d1', 'SW-01', { deviceModelId: 'm1', modelPhotoVersion: '2026-10-01T00:00:00.000Z' }),
            row('d2', 'SW-02'),
            row('d3', 'AP-03', { deviceTypeId: 't2', deviceTypeName: 'Access Point' }),
            row('d4', 'AP-04', { deviceTypeId: 't2', deviceTypeName: 'Access Point', deviceModelId: 'm4', modelPhotoVersion: 'v1' }),
          ],
          total: 4,
        }));
      }
      if (url.startsWith('/api/v1/ipam/devices/addresses')) {
        return Promise.resolve(jsonResponse(200, { d1: ['10.0.0.1', '10.0.0.2'] }));
      }
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(
          jsonResponse(200, {
            sites: [],
            cabinets: [],
            deviceTypes: [
              { id: 't1', name: 'Switch', hasPortMap: true, isRouter: false, description: null, active: true, icon: 'switch', photoFileId: null },
              { id: 't2', name: 'Access Point', hasPortMap: false, isRouter: false, description: null, active: true, icon: 'access_point', photoFileId: 'f9' },
            ],
            vendors: [],
            departments: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
}

function renderScreen() {
  renderWithI18n(
    <MemoryRouter initialEntries={['/devices']}>
      <ToastProvider>
        <ConfirmProvider>
          <DevicesScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('/devices — cột theo Q-27', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đúng bộ cột; không còn Người dùng, Bảo hành', async () => {
    mockFetch();
    renderScreen();
    const table = await screen.findByRole('table', {}, { timeout: 5000 });
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim());
    for (const name of ['Ảnh', 'Mã thiết bị', 'Tên gọi', 'IP quản trị', 'Vị trí', 'Trạng thái']) {
      expect(headers).toContain(name);
    }
    expect(headers).not.toContain('Người dùng');
    expect(headers).not.toContain('Bảo hành');
  });

  it('cột IP: IP đầu + số còn lại; máy không có IP thì "—"', async () => {
    mockFetch();
    renderScreen();
    const r1 = await screen.findByRole('row', { name: /SW-01/ }, { timeout: 5000 });
    expect(await within(r1).findByText('10.0.0.1 +1')).toBeInTheDocument();
    const r2 = screen.getByRole('row', { name: /SW-02/ });
    expect(within(r2).getByTestId('device-ip')).toHaveTextContent('—');
  });

  it('dưới tên không còn dòng loại · model · serial', async () => {
    mockFetch();
    renderScreen();
    const r1 = await screen.findByRole('row', { name: /SW-01/ }, { timeout: 5000 });
    expect(within(r1).queryByText(/C9200/)).toBeNull();
    expect(within(r1).queryByText('SN-1')).toBeNull();
  });

  it('cột Ảnh: model có ảnh thì là ảnh model', async () => {
    mockFetch();
    renderScreen();
    const r1 = await screen.findByRole('row', { name: /SW-01/ }, { timeout: 5000 });
    const img = within(r1).getByRole('img', { name: 'Ảnh SW-01' });
    expect(img.getAttribute('src')).toContain('/api/v1/device-models/m1/photo/front');
  });

  // PW-A18 (Q-33): khung trống không in tên loại chữ nhỏ — biểu tượng loại, tên loại khi rê chuột.
  it('cột Ảnh: chưa có ảnh thì biểu tượng của loại, tên loại ở title; loại có ảnh riêng thì ảnh đó', async () => {
    mockFetch();
    renderScreen();
    const r2 = await screen.findByRole('row', { name: /SW-02/ }, { timeout: 5000 });
    const thumb = within(r2).getByTestId('device-thumb');
    expect(await within(thumb).findByRole('img', { name: 'Switch' })).toHaveAttribute('title', 'Switch');
    expect(thumb.querySelector('svg[data-icon="switch"]')).not.toBeNull();
    expect(thumb).not.toHaveTextContent('Switch');
    const r3 = screen.getByRole('row', { name: /AP-03/ });
    const photo = await within(r3).findByRole('img', { name: 'Access Point' });
    expect(photo.getAttribute('src')).toBe('/api/v1/catalog/device-types/t2/photo?v=f9');
  });

  // Hai ảnh cùng hỏng (model + loại): dừng ở biểu tượng, không đổi qua lại hai URL mãi.
  it('cột Ảnh: ảnh model lẫn ảnh loại đều hỏng thì về biểu tượng, không đổi qua lại', async () => {
    mockFetch();
    renderScreen();
    // Chờ cột IP về (bảng dựng lại hàng một lượt) để thẻ ảnh không bị thay giữa chừng.
    const r1 = await screen.findByRole('row', { name: /SW-01/ }, { timeout: 5000 });
    await within(r1).findByText('10.0.0.1 +1');
    const r4 = screen.getByRole('row', { name: /AP-04/ });
    const thumb = within(r4).getByTestId('device-thumb');
    const first = within(thumb).getByRole('img', { name: 'Ảnh AP-04' });
    expect(first.getAttribute('src')).toContain('/api/v1/device-models/m4/photo/front');
    fireEvent.error(first);
    const second = await within(thumb).findByRole('img', { name: 'Access Point' });
    expect(second.tagName).toBe('IMG');
    fireEvent.error(second);
    await waitFor(() => expect(thumb.querySelector('img')).toBeNull());
    expect(thumb.querySelector('svg[data-icon="access_point"]')).not.toBeNull();
  });
});

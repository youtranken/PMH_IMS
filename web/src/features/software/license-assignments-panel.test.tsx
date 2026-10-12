import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { LicenseAssignmentsPanel } from './license-assignments-panel';
import type { SoftwareRow } from './software-types';

/**
 * Tab Máy đang dùng (Q-27): "Lưu rồi gán vào máy" mở sẵn hộp Gán MỘT lần (báo nơi gọi gỡ
 * `?assign=1`, nếu không đổi tab / F5 là hộp bật lại); ghế còn trống có nút gán vào đúng ghế.
 */

afterEach(() => vi.unstubAllGlobals());

const LIC: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-PANEL',
  name: 'Office',
  kind: 'license',
  licenseModel: 'perpetual',
  vendorId: null,
  vendorName: null,
  seatTotal: 3,
  seatUsed: 0,
  startDate: null,
  endDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
  perSeat: true,
};

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] }));
      }
      if (url.includes('/assignments')) return Promise.resolve(jsonResponse(200, []));
      if (url === '/api/v1/software/sw1') return Promise.resolve(jsonResponse(200, { ...LIC, seats: [] }));
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
}

describe('LicenseAssignmentsPanel', () => {
  it('autoAssign: mở hộp Gán và báo nơi gọi đã dùng (để gỡ ?assign=1) đúng một lần', async () => {
    mockFetch();
    const used = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <LicenseAssignmentsPanel software={LIC} autoAssign onAutoAssignUsed={used} csrfToken="t" />
      </ToastProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Gán license vào máy — LIC-E2E-PANEL' })).toBeInTheDocument();
    expect(used).toHaveBeenCalledTimes(1);
  });

  it('ghế còn trống có nút "Gán máy vào Ghế n" mở hộp Gán', async () => {
    mockFetch();
    renderWithI18n(
      <ToastProvider>
        <LicenseAssignmentsPanel
          software={LIC}
          seats={[
            { id: 's1', seatNo: 1, contract: 'PO-A', note: null, assignmentId: null, deviceId: null },
            { id: 's2', seatNo: 2, contract: null, note: 'dự phòng', assignmentId: null, deviceId: null },
          ]}
          csrfToken="t"
        />
      </ToastProvider>,
    );
    const free = screen.getByRole('region', { name: 'Ghế còn trống' });
    await userEvent.setup().click(within(free).getByRole('button', { name: 'Gán máy vào Ghế 2' }));
    expect(await screen.findByRole('dialog', { name: 'Gán license vào máy — LIC-E2E-PANEL' })).toBeInTheDocument();
  });
});

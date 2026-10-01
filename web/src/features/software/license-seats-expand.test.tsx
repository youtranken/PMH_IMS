import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { LicenseSeatsExpand } from './license-seats-expand';
import type { SoftwareRow } from './software-types';

afterEach(() => vi.unstubAllGlobals());

const LICENSE: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-EXP',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 2,
  seatUsed: 2,
  startDate: null,
  endDate: '2030-01-01',
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

function render(software: SoftwareRow) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(200, []))),
  );
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter>
          <LicenseSeatsExpand software={software} csrfToken="t" />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Khu bung dòng license — mẫu chuẩn ExpandHeader', () => {
  it('đầu khu: "Ghế đang dùng" + số đếm + cờ hết ghế + nút chính "Gán vào máy"', async () => {
    render(LICENSE);
    const title = screen.getByText('Ghế đang dùng', { exact: true });
    const head = title.parentElement!;
    expect(head.textContent).toContain('2/2');
    expect(head.textContent).toContain('Hết ghế');
    await userEvent.click(screen.getByRole('button', { name: 'Gán vào máy' }));
    expect(await screen.findByRole('dialog', { name: /Gán license vào máy/ })).toBeInTheDocument();
  });

  it('license thanh lý: đầu khu vẫn có số đếm nhưng không có nút gán', () => {
    render({ ...LICENSE, status: 'retired', seatUsed: 0 });
    expect(screen.getByText('Ghế đang dùng', { exact: true }).parentElement!.textContent).toContain(
      '0/2',
    );
    expect(screen.queryByRole('button', { name: 'Gán vào máy' })).toBeNull();
  });
});

describe('Khu bung dòng license — khung chung + bảng con', () => {
  it('đầu khu và bảng ghế nằm cùng khung ExpandPanel; bảng ghế là bảng con `table-sub`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, [
            {
              id: 'seat1',
              deviceId: 'd1',
              deviceCode: 'PC-01',
              deviceName: 'Máy kế toán',
              deviceAssignedTo: null,
              assignedBy: 'sa@pmh.com.vn',
              assignedAt: '2026-01-01T00:00:00Z',
              startDate: null,
              endDate: null,
              cost: null,
              contract: null,
              note: null,
            },
          ]),
        ),
      ),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <MemoryRouter>
            <LicenseSeatsExpand software={LICENSE} csrfToken="t" />
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>,
    );
    const table = await screen.findByRole('table');
    expect(table).toHaveClass('table-sub');
    expect(screen.getByTestId('expand-header').closest('.exp-panel')).toBe(table.closest('.exp-panel'));
  });
});

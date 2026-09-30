import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DevicesScreen } from './devices-screen';

/**
 * Bung dòng /devices theo mẫu chuẩn Q-18 (giống /software): mũi tên trơn, số license nằm trong
 * TÊN nút (`expandLabel`) và trong đầu khu bung (`ExpandHeader`) — không còn chữ "N license"
 * in trên nút.
 */

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

function row(id: string, code: string) {
  return {
    id,
    code,
    name: `Máy ${code}`,
    deviceTypeId: 't1',
    deviceTypeName: 'PC',
    hasPortMap: false,
    model: null,
    serial: null,
    siteId: null,
    siteCode: null,
    cabinetId: null,
    cabinetCode: null,
    vendorId: null,
    vendorName: null,
    assignedTo: null,
    department: null,
    purchaseDate: null,
    warrantyStart: null,
    warrantyEnd: null,
    status: 'in_use',
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/v1/devices?')) {
        return Promise.resolve(
          jsonResponse(200, { items: [row('d1', 'PC-01'), row('d2', 'PC-02')], total: 2 }),
        );
      }
      if (url.startsWith('/api/v1/software/installed/counts')) {
        return Promise.resolve(jsonResponse(200, { d1: 2 }));
      }
      if (url.startsWith('/api/v1/software/installed/d1')) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith('/api/v1/ipam/devices/addresses')) return Promise.resolve(jsonResponse(200, {}));
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(
          jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [] }),
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

describe('/devices — bung dòng license theo mẫu chuẩn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mũi tên trơn, tên nút mang mã máy + số license; khu bung có đầu khu "License đang cài 2"', async () => {
    mockFetch();
    renderScreen();
    const user = userEvent.setup();
    const toggle = await screen.findByRole(
      'button',
      { name: 'Mở rộng PC-01 — 2 license' },
      // Bảng và số đếm là hai lượt gọi nối nhau — chạy chung cả bộ thì 1 giây mặc định không đủ.
      { timeout: 5000 },
    );
    expect(toggle.textContent).toBe('');

    await user.click(toggle);
    const open = screen.getByRole('button', { name: 'Thu gọn PC-01 — 2 license' });
    const region = document.getElementById(open.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(within(region).getByText('License đang cài')).toBeInTheDocument();
    expect(within(region).getByText('2')).toBeInTheDocument();
  });

  it('đường hỏng: máy không cài gì thì không có mũi tên bung', async () => {
    mockFetch();
    renderScreen();
    await screen.findByRole(
      'button',
      { name: 'Mở rộng PC-01 — 2 license' },
      // Bảng và số đếm là hai lượt gọi nối nhau — chạy chung cả bộ thì 1 giây mặc định không đủ.
      { timeout: 5000 },
    );
    expect(screen.queryByRole('button', { name: /Mở rộng PC-02/ })).toBeNull();
  });
});

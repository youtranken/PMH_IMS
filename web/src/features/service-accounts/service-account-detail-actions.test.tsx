import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { Me } from '@/lib/me';
import { ServiceAccountDetail } from './service-account-detail';

/**
 * NET-072: trang hồ sơ TKDV có "Sửa hồ sơ" và menu ⋯ "Vô hiệu hóa…/Bật lại…" cho SA/Admin —
 * không phải quay ra danh sách, tìm dòng rồi mở ⋯.
 */

const ROW = {
  id: 'sa-1',
  code: 'VPN-E2E-01',
  name: 'VPN kế toán',
  kind: 'vpn',
  login: 'ketoan',
  department: 'Kế toán',
  ownerName: null,
  groupName: null,
  allowedIps: null,
  note: null,
  status: 'active',
};

function mockFetch(status: 'active' | 'disabled') {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/service-accounts/sa-1') {
        return Promise.resolve(jsonResponse(200, { ...ROW, status }));
      }
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, {}));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
}

function renderAs(role: Me['role']) {
  const me = { role, csrfToken: 'x', email: 'a@pmh.com.vn' } as unknown as Me;
  return renderWithI18n(
    <MemoryRouter initialEntries={['/service-accounts/sa-1']}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/service-accounts/:id" element={<ServiceAccountDetail me={me} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Trang hồ sơ TKDV — nút Sửa và đổi trạng thái', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('SA: có "Sửa hồ sơ"; ⋯ → "Vô hiệu hóa…" mở hộp đòi lý do', async () => {
    mockFetch('active');
    renderAs('sa');
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Sửa hồ sơ' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Thao tác với VPN-E2E-01' }));
    // Ngừng dùng đảo lại được: màu cảnh báo, không đỏ — đỏ dành cho việc không quay lại được.
    const disable = screen.getByRole('menuitem', { name: 'Ngừng dùng…' });
    expect(disable).toHaveClass('warn');
    expect(disable).not.toHaveClass('danger');
    await user.click(disable);
    expect(
      await screen.findByRole('dialog', { name: 'Ngừng dùng — VPN-E2E-01' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Lý do ngừng dùng/ })).toBeVisible();
  });

  it('hồ sơ đã vô hiệu: menu đổi thành "Bật lại…"', async () => {
    mockFetch('disabled');
    renderAs('admin');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với VPN-E2E-01' }));
    expect(screen.getByRole('menuitem', { name: 'Dùng lại…' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Dùng lại…' })).toHaveClass('ok');
    expect(screen.getByText('Đã ngừng dùng', { selector: '.badge' })).toHaveClass('danger');
    expect(screen.queryByRole('menuitem', { name: 'Ngừng dùng…' })).toBeNull();
  });

  it('member: không có nút nào để bấm rồi ăn 403', async () => {
    mockFetch('active');
    renderAs('member');
    await screen.findByRole('heading', { name: /VPN-E2E-01/ });
    expect(screen.queryByRole('button', { name: 'Sửa hồ sơ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thao tác với VPN-E2E-01' })).toBeNull();
  });
});

describe('Trang hồ sơ TKDV — thanh tab (NET-075)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('không có ?tab= thì mở vào Két sắt — khu Hồ sơ đã ra khỏi thanh tab, không còn tab "profile"', async () => {
    mockFetch('active');
    renderAs('sa');
    const vault = await screen.findByRole('tab', { name: /^Két sắt/ });
    expect(vault).toHaveAttribute('aria-selected', 'true');
  });
});

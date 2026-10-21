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

  it('hồ sơ đã ngừng dùng: "Dùng lại…" và trạng thái chỉ ở băng đầu trang, mỗi thứ một lần', async () => {
    mockFetch('disabled');
    renderAs('admin');
    const user = userEvent.setup();
    const banner = await screen.findByRole('note');
    expect(banner).toHaveTextContent('Đã ngừng dùng');
    expect(screen.getAllByRole('button', { name: 'Dùng lại…' })).toHaveLength(1);
    // Menu ⋮ chỉ còn đúng mục đó thì bỏ hẳn — băng đã có nút.
    expect(screen.queryByRole('button', { name: 'Thao tác với VPN-E2E-01' })).toBeNull();
    expect(screen.getAllByText('Đã ngừng dùng')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Dùng lại…' }));
    expect(await screen.findByRole('dialog', { name: 'Dùng lại — VPN-E2E-01' })).toBeVisible();
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

describe('Trang hồ sơ TKDV — khuôn C (Q-27)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('trạng thái dưới mã; dải 4 ô có tên đăng nhập + chép; không còn "Thẻ định danh"', async () => {
    mockFetch('active');
    renderAs('sa');
    const strip = await screen.findByRole('group', { name: 'Tóm tắt tài khoản' });
    expect(strip).toHaveTextContent('Tên đăng nhậpketoan');
    expect(screen.getByRole('button', { name: 'Sao chép tên đăng nhập' })).toBeInTheDocument();
    // VPN để trống dải IP là mở cho mọi IP — huy hiệu nằm ở ô thứ tư.
    expect(strip).toHaveTextContent('Mọi IP');
    // Chưa có người phụ trách: ô vẫn đứng, ghi "chưa khai".
    expect(strip).toHaveTextContent('Người phụ tráchchưa khai');
    expect(screen.queryByRole('region', { name: 'Thẻ định danh' })).toBeNull();
    expect(screen.getByText('Đang dùng')).toBeInTheDocument();
    const info = screen.getByRole('group', { name: 'Thông tin' });
    expect(info).toHaveTextContent('Nhóm VPNchưa khai');
    expect(info).toHaveTextContent('Phòng banKế toán');
    // Chỉ đếm ô của khối Thông tin: Nhóm VPN, Ghi chú. Người phụ trách trống ở dải 4 ô không tính.
    expect(screen.getByRole('button', { name: 'Bổ sung 2 ô còn thiếu' })).toBeInTheDocument();
  });

  it('chưa khai phòng ban: khối Thông tin nói ra và đếm vào "Bổ sung"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/service-accounts/sa-1') {
          return Promise.resolve(
            jsonResponse(200, { ...ROW, department: null, groupName: 'g', note: 'n' }),
          );
        }
        return Promise.resolve(jsonResponse(200, url.startsWith('/api/v1/catalog') ? {} : []));
      }),
    );
    renderAs('sa');
    const info = await screen.findByRole('group', { name: 'Thông tin' });
    expect(info).toHaveTextContent('Phòng banchưa khai');
    expect(screen.getByRole('button', { name: 'Bổ sung 1 ô còn thiếu' })).toBeInTheDocument();
  });
});

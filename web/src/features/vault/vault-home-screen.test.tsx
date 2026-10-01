import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { VaultHomeScreen } from './vault-home-screen';

/**
 * Trang tổng Két sắt: lọc loại là dải nút dùng chung (không phải nút chính), kết quả rỗng gợi
 * ý theo đúng tình huống, và bảng sắp được theo lần đổi gần nhất.
 */

const SA = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const OWNERS = [
  {
    ownerType: 'device',
    ownerId: 'd1',
    code: 'SW-E2E-01',
    name: 'Switch lõi',
    siteCode: 'HCM',
    secretCount: 2,
    lastChangeAt: '2026-09-20T01:30:00.000Z',
    orphan: false,
    retired: false,
  },
  {
    ownerType: 'software',
    ownerId: 's1',
    code: 'LIC-E2E-01',
    name: 'License',
    siteCode: null,
    secretCount: 1,
    lastChangeAt: '2025-01-02T01:30:00.000Z',
    orphan: false,
    retired: false,
  },
  {
    ownerType: 'service_account',
    ownerId: 'sa1',
    code: 'VPN-E2E-01',
    name: 'VPN cũ',
    siteCode: null,
    secretCount: 1,
    lastChangeAt: '2025-01-02T01:30:00.000Z',
    orphan: false,
    retired: true,
  },
];

function renderHome(entry = '/vault') {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(200, OWNERS))),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <VaultHomeScreen me={SA} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Trang tổng Két sắt', () => {
  it('nút lọc loại là dải chip (aria-pressed), không phải nút chính', async () => {
    renderHome();
    const device = await screen.findByRole('button', { name: /^Thiết bị \d+$/ });
    expect(device).toHaveAttribute('aria-pressed', 'false');
    expect(device).not.toHaveClass('primary');
    await userEvent.click(device);
    expect(device).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('LIC-E2E-01')).not.toBeInTheDocument();
  });

  it('có cột Site, và sắp được theo "Thay đổi gần nhất" (cũ nhất lên đầu)', async () => {
    renderHome();
    await screen.findByText('SW-E2E-01');
    expect(screen.getByRole('columnheader', { name: /Site/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Thay đổi gần nhất/ }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('LIC-E2E-01');
  });

  // Két của hồ sơ đã bỏ vẫn hiện (còn phải dọn) nhưng có nhãn trạng thái theo đúng tên của module chủ.
  it('chủ đã thanh lý / ngừng dùng mang nhãn trạng thái', async () => {
    renderHome();
    const row = (await screen.findByText('VPN-E2E-01')).closest('tr')!;
    expect(row).toHaveTextContent('Đã ngừng dùng');
    const live = screen.getByText('SW-E2E-01').closest('tr')!;
    expect(live).not.toHaveTextContent('Đã thanh lý');
  });

  it('tìm không ra: có nút "Xoá tìm kiếm", không gợi ý bỏ lọc khi không bật lọc nào', async () => {
    renderHome('/vault?q=khong-co-gi');
    expect(await screen.findByText('Không có hồ sơ nào khớp bộ lọc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa tìm kiếm' })).toBeInTheDocument();
    expect(screen.queryByText(/bỏ bớt bộ lọc loại/)).not.toBeInTheDocument();
    // Dòng tổng kết "0 hồ sơ · 0 ngăn" thừa ngay trên khối rỗng.
    expect(screen.queryByText(/hồ sơ đang giữ két/)).not.toBeInTheDocument();
  });

  /* Q-21: luật két nằm sau một nút mở hộp đọc, không chiếm chỗ cố định cuối trang. */
  it('phụ đề liệt kê bốn loại hồ sơ; luật két chỉ hiện khi bấm nút "Luật két"', async () => {
    renderHome();
    expect(
      await screen.findByText(
        'Hồ sơ đang có mật khẩu trong két bao gồm: thiết bị, phần mềm, tài khoản dịch vụ, đường truyền',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Luật của két' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mỗi lần mở đều ghi nhật ký/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Luật két' }));
    const dialog = await screen.findByRole('dialog', { name: 'Luật của két' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4);
    expect(dialog).toHaveTextContent(/Trang này chỉ liệt kê hồ sơ và số ngăn/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Đóng', exact: true }));
    expect(screen.queryByRole('dialog', { name: 'Luật của két' })).not.toBeInTheDocument();
  });
});

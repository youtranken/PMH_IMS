import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { DisposalScreen } from './disposal-screen';

const DEVICE = {
  kind: 'device',
  id: 'd1',
  code: 'PC-E2E-01',
  name: 'Máy cũ',
  detail: 'PC',
  status: 'retired',
  updatedAt: '2026-09-20T01:30:00.000Z',
  disposedAt: '2026-09-20T01:30:00.000Z',
  disposedBy: 'system',
  disposedByName: null,
  auto: true,
  reason: null,
};

const COUNTS = { device: 1, software: 0, service_account: 0, isp: 0 };

const SERVICE_ACCOUNT = {
  ...DEVICE,
  kind: 'service_account',
  id: 's1',
  code: 'TK-E2E-01',
  name: 'Tài khoản cũ',
  detail: 'shared',
  status: 'disabled',
  auto: false,
};

const SOFTWARE = {
  ...DEVICE,
  kind: 'software',
  id: 'w1',
  code: 'SW-E2E-01',
  name: 'Phần mềm cũ',
  detail: 'license',
  auto: false,
};

function renderWith(truncated: string[], items: unknown[] = [DEVICE]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(jsonResponse(200, { items, total: items.length, counts: COUNTS, truncated })),
    ),
  );
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <DisposalScreen />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * OLD-BE-02 — mỗi loại chỉ tải tối đa một trần dòng. Loại bị cắt thì màn phải nói ra, không để
 * người đọc tưởng kho chỉ có chừng đó.
 */
describe('Kho thanh lý', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loại bị cắt → báo rõ tên loại', async () => {
    renderWith(['device', 'isp']);
    expect(await screen.findByText(/chưa hiện hết/)).toHaveTextContent(/Thiết bị, Đường truyền/);
    expect(screen.getByText('PC-E2E-01')).toBeInTheDocument();
  });

  it('không loại nào bị cắt → không báo gì', async () => {
    renderWith([]);
    await screen.findByText('PC-E2E-01');
    expect(screen.queryByText(/chưa hiện hết/)).toBeNull();
  });

  /* DP-002: hồ sơ tự thanh lý khi quá hạn (Q-13) phải khác hẳn hồ sơ có người bấm. */
  it('tự thanh lý → cột Người thanh lý ghi "Hệ thống"', async () => {
    renderWith([]);
    expect(await screen.findByText('Hệ thống · tự thanh lý khi quá hạn')).toBeInTheDocument();
  });

  /* Q-19: màu badge theo màn gốc — tài khoản dịch vụ "Đã ngừng dùng" đỏ như ở danh sách của nó. */
  it('badge trạng thái mang màu của màn gốc', async () => {
    renderWith([], [DEVICE, SERVICE_ACCOUNT]);
    expect(await screen.findByText('Đã ngừng dùng')).toHaveClass('badge', 'danger');
    expect(screen.getByText('Đã thanh lý')).toHaveClass('badge', 'muted');
  });

  /* Q-19: "Dùng lại" thiết bị / tài khoản dịch vụ / đường truyền làm ở trang hồ sơ, không tại kho. */
  it('thiết bị, tài khoản dịch vụ: menu có lối mở hồ sơ để dùng lại (màu ok)', async () => {
    const user = userEvent.setup();
    renderWith([], [DEVICE, SERVICE_ACCOUNT]);
    await user.click(await screen.findByRole('button', { name: 'Thao tác với TK-E2E-01' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Mở hồ sơ',
      'Mở hồ sơ để dùng lại',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Mở hồ sơ để dùng lại' })).toHaveClass('ok');
  });

  it('phần mềm: "Khôi phục…" tô ok, không có lối dùng lại riêng', async () => {
    const user = userEvent.setup();
    renderWith([], [SOFTWARE]);
    await user.click(await screen.findByRole('button', { name: 'Thao tác với SW-E2E-01' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Mở hồ sơ',
      'Khôi phục…',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Khôi phục…' })).toHaveClass('ok');
  });

  /* Q-20: hai ô ngày là MỘT cụm "từ – đến" trên cùng hàng; chữ trong ô ngắn, tên đầy đủ ở nhãn. */
  it('khoảng ngày thanh lý: hai ô chung một cụm, chữ ngắn "Từ ngày"/"Đến ngày"', async () => {
    renderWith([]);
    await screen.findByText('PC-E2E-01');
    const range = screen.getByRole('group', { name: 'Khoảng ngày thanh lý' });
    const from = within(range).getByRole('button', { name: 'Thanh lý từ ngày' });
    const to = within(range).getByRole('button', { name: 'Thanh lý đến ngày' });
    expect(from).toHaveTextContent('Từ ngày');
    expect(to).toHaveTextContent('Đến ngày');
  });
});

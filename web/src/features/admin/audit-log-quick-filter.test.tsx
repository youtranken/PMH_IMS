import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { todayIso } from '@/lib/format';
import { recentRange } from '@/lib/period-range';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import { AuditLogScreen } from './audit-log-screen';

const ROWS = [
  {
    id: 'r2',
    actor: 'le.minh@pmh.com.vn',
    actorName: 'Lê Minh',
    action: 'vault.secret.revealed',
    objectType: null,
    objectId: null,
    ip: null,
    detail: null,
    createdAt: '2026-09-21T02:00:00.000Z',
  },
  {
    id: 'r1',
    actor: 'le.minh@pmh.com.vn',
    actorName: 'Lê Minh',
    action: 'auth.login.ok',
    objectType: null,
    objectId: null,
    ip: null,
    detail: null,
    createdAt: '2026-09-20T01:30:00.000Z',
  },
];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/audit/actions')) {
        return Promise.resolve(
          jsonResponse(200, ['vault.secret.revealed', 'auth.login.ok', 'auth.logout']),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: ROWS, total: 2, totalCapped: false }));
    }),
  );
}

function Address() {
  return <output aria-label="địa chỉ">{useLocation().search}</output>;
}

function renderAt(entry: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <AuditLogScreen />
        <Address />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Nhật ký — lọc nhanh theo ngày, nhóm theo ngày, chọn hành động theo module', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('"7 ngày" điền đúng từ–đến lên URL và sáng nút; bấm lại là gỡ', async () => {
    stubFetch();
    renderAt('/admin/audit-log');
    const preset = await screen.findByRole('radio', { name: '7 ngày' });
    await userEvent.click(preset);
    const { from, to } = recentRange(7, todayIso());
    const address = screen.getByRole('status', { name: 'địa chỉ' });
    expect(address.textContent).toContain(`from=${from}`);
    expect(address.textContent).toContain(`to=${to}`);
    expect(screen.getByRole('radio', { name: '7 ngày' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '7 ngày' }));
    expect(address.textContent).not.toContain('from=');
  });

  it('bảng có tiêu đề theo ngày và dòng "Đang xem …" phủ đúng khoảng của trang', async () => {
    stubFetch();
    renderAt('/admin/audit-log');
    expect(await screen.findByRole('rowheader', { name: '21/09/2026' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '20/09/2026' })).toBeInTheDocument();
    expect(screen.getByText('Đang xem 20/09/2026 08:30 → 21/09/2026 09:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tới ngày…' })).toBeInTheDocument();
  });

  it('ô Hành động chia nhóm theo module', async () => {
    stubFetch();
    renderAt('/admin/audit-log');
    await screen.findAllByText('Lê Minh', { selector: 'td' });
    await userEvent.click(screen.getByRole('button', { name: 'Hành động' }));
    const titles = Array.from(document.querySelectorAll('.fsel-group')).map((node) => node.textContent);
    expect(titles).toEqual(['Đăng nhập & phiên', 'Két sắt']);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Mọi hành động',
      'Đăng nhập',
      'Đăng xuất',
      'Xem mật khẩu trong két',
    ]);
  });
});

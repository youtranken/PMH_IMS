import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { AccountsScreen, tempLockOf } from './accounts-screen';

const ME = { id: 'u-sa', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();

const ROWS = [
  {
    id: 'u-sa',
    email: 'sa@pmh.com.vn',
    fullName: 'E2E Super Admin',
    phone: null,
    employeeCode: null,
    birthDate: null,
    role: 'sa',
    status: 'active',
    totpEnrolledAt: '2026-09-01T00:00:00Z',
    totpLoginRequired: true,
    lastLoginAt: new Date().toISOString(),
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'u-tv',
    email: 'tv@pmh.com.vn',
    fullName: 'E2E Thành viên',
    phone: '0912 345 678',
    employeeCode: 'NV-1',
    birthDate: null,
    role: 'member',
    status: 'active',
    totpEnrolledAt: null,
    totpLoginRequired: true,
    lastLoginAt: null,
    failedAttempts: 5,
    lockedUntil: IN_AN_HOUR,
    createdAt: '2026-09-20T00:00:00Z',
  },
];

function stubFetch() {
  const fetchMock = vi.fn((_input: RequestInfo | URL) =>
    Promise.resolve(jsonResponse(200, { items: ROWS, total: 2 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(entry: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <AccountsScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function menuOf(user: ReturnType<typeof userEvent.setup>, name: string): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: `Thao tác với ${name}` }));
  const names = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
  await user.keyboard('{Escape}');
  return names;
}

describe('tempLockOf — tạm chặn do gõ sai', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  it.each([
    ['đang hoạt động, mốc còn tương lai', 'active', '2026-09-28T10:30:00Z', true],
    ['mốc đã qua', 'active', '2026-09-28T09:00:00Z', false],
    ['không có mốc', 'active', null, false],
    ['đang KHÓA thì đã có badge Khóa, không nói thêm', 'locked', '2026-09-28T10:30:00Z', false],
  ])('%s', (_case, status, lockedUntil, expected) => {
    const row = { status: status as 'active', lockedUntil, failedAttempts: 5 };
    expect(tempLockOf(row, now) !== null).toBe(expected);
  });
});

describe('Màn Tài khoản', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bộ lọc trên URL đi thẳng lên API (vai, trạng thái, 2 lớp)', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/accounts?role=member&status=locked&totp=none');
    await screen.findByText('E2E Thành viên');
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.searchParams.get('role')).toBe('member');
    expect(url.searchParams.get('status')).toBe('locked');
    expect(url.searchParams.get('totp')).toBe('none');
  });

  it('dòng của chính mình mang chip "Bạn" và không có Khóa / Vô hiệu / Đặt lại 2 lớp / Đổi vai', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/accounts');
    await screen.findByText('E2E Super Admin');
    expect(screen.getByText('Bạn')).toBeInTheDocument();
    const own = await menuOf(user, 'E2E Super Admin');
    for (const hidden of ['Khóa', 'Vô hiệu hóa', 'Đặt lại xác thực 2 lớp', 'Đổi vai trò…']) {
      expect(own).not.toContain(hidden);
    }
    const other = await menuOf(user, 'E2E Thành viên');
    expect(other).toEqual(
      expect.arrayContaining(['Khóa', 'Vô hiệu hóa', 'Đổi vai trò…', 'Quyền két sắt', 'Gỡ tạm chặn']),
    );
  });

  it('menu chia nhóm: Đặt lại mật khẩu không đỏ, Khóa là cảnh báo, Vô hiệu hóa đỏ', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/accounts');
    await screen.findByText('E2E Thành viên');
    await user.click(screen.getByRole('button', { name: 'Thao tác với E2E Thành viên' }));
    expect(screen.getByRole('menuitem', { name: 'Đặt lại mật khẩu' })).not.toHaveClass('danger');
    expect(screen.getByRole('menuitem', { name: 'Khóa' })).toHaveClass('warn');
    expect(screen.getByRole('menuitem', { name: 'Vô hiệu hóa' })).toHaveClass('danger');
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(2);
  });

  it('tài khoản đang tạm chặn vì gõ sai: nói ra cạnh trạng thái; chưa từng đăng nhập thì nói rõ', async () => {
    stubFetch();
    renderAt('/admin/accounts');
    await screen.findByText('E2E Thành viên');
    expect(screen.getByText(/Tạm chặn tới .* \(5 lần sai\)/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa đăng nhập · tạo/)).toBeInTheDocument();
  });

  it('Khóa bắt ghi lý do trước khi gửi', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderAt('/admin/accounts');
    await screen.findByText('E2E Thành viên');
    await user.click(screen.getByRole('button', { name: 'Thao tác với E2E Thành viên' }));
    await user.click(screen.getByRole('menuitem', { name: 'Khóa' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Khóa' }));
    expect(await screen.findByText('Bắt buộc — chưa nhập ô này.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/status')),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Nghỉ việc' }));
    expect(screen.getByRole('textbox', { name: /Lý do/ })).toHaveValue('Nghỉ việc');
    await waitFor(() => expect(dialog).toBeInTheDocument());
  });
});

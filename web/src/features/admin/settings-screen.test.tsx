import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { SettingsScreen } from './settings-screen';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const ROWS = [
  {
    name: 'loginRateLimitPerIp',
    key: 'login.rate_limit_per_ip',
    group: 'auth',
    type: 'int',
    unit: 'per_minute',
    min: 5,
    max: 1000,
    warnAbove: 100,
    defaultValue: 20,
    value: 20,
    updatedAt: '2026-09-20T01:30:00.000Z',
    updatedBy: 'cao.thuan@pmh.com.vn',
  },
  {
    name: 'softwareAutoRetireGraceDays',
    key: 'software.auto_retire_grace_days',
    group: 'software',
    type: 'int',
    unit: 'days',
    min: 0,
    max: 365,
    warnZero: true,
    defaultValue: 30,
    value: 30,
    updatedAt: null,
    updatedBy: null,
  },
];

function renderAt(entry: string) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(jsonResponse(200, ROWS)),
  );
  vi.stubGlobal('fetch', fetchMock);
  renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <SettingsScreen me={ME} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('Màn Tham số hệ thống', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nhóm Đăng nhập: nhãn tiếng Việt, đơn vị, mặc định, ai sửa lần cuối', async () => {
    renderAt('/admin/settings');
    expect(await screen.findByLabelText('Số lượt đăng nhập tối đa mỗi IP')).toHaveValue('20');
    expect(screen.getByText('lần/phút')).toBeInTheDocument();
    expect(screen.getByText(/Mặc định: 20 lần\/phút/)).toBeInTheDocument();
    expect(screen.getByText(/Sửa lần cuối bởi cao.thuan@pmh.com.vn/)).toBeInTheDocument();
  });

  it('nới quá ngưỡng → cảnh báo; Lưu mở hộp Trước → Sau, chưa gửi gì', async () => {
    const fetchMock = renderAt('/admin/settings');
    const input = await screen.findByLabelText('Số lượt đăng nhập tối đa mỗi IP');
    await userEvent.clear(input);
    await userEvent.type(input, '150');
    expect(screen.getByText(/hàng rào này bị nới rất rộng/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu nhóm này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận đổi tham số' });
    expect(dialog).toHaveTextContent('20 lần/phút → 150 lần/phút');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('ngoài khoảng → lỗi cạnh ô và nút Lưu tắt', async () => {
    renderAt('/admin/settings');
    const input = await screen.findByLabelText('Số lượt đăng nhập tối đa mỗi IP');
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    expect(screen.getByText('Phải từ 5 đến 1000.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu nhóm này' })).toBeDisabled();
  });

  it('?group=software mở đúng nhóm; 0 = tắt có cảnh báo', async () => {
    renderAt('/admin/settings?group=software');
    const input = await screen.findByLabelText('Ân hạn trước khi tự Thanh lý phần mềm hết hạn');
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    expect(screen.getByText('Đặt 0 là TẮT hẳn chức năng này.')).toBeInTheDocument();
  });
});

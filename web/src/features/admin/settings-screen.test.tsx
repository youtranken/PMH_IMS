import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
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
  {
    name: 'natWidePortRange',
    key: 'nat.wide_port_range',
    group: 'ipam',
    type: 'int',
    unit: 'ports',
    min: 10,
    max: 65535,
    defaultValue: 1000,
    value: 1000,
    updatedAt: null,
    updatedBy: null,
  },
  {
    name: 'fileMaxSizeMb',
    key: 'file.max_size_mb',
    group: 'files',
    type: 'int',
    unit: 'mb',
    min: 1,
    max: 25,
    defaultValue: 25,
    value: 25,
    updatedAt: null,
    updatedBy: null,
  },
  {
    name: 'fileMaxFilesPerBatch',
    key: 'file.max_files_per_batch',
    group: 'files',
    type: 'int',
    unit: 'files',
    min: 1,
    max: 20,
    defaultValue: 6,
    value: 6,
    updatedAt: null,
    updatedBy: null,
  },
  {
    name: 'filePurgeAfterDays',
    key: 'file.purge_after_days',
    group: 'files',
    type: 'int',
    unit: 'days',
    min: 7,
    max: 3650,
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

  it('nhóm Mạng IP & NAT: nhãn tiếng Việt và đơn vị cổng', async () => {
    renderAt('/admin/settings?group=ipam');
    expect(await screen.findByLabelText('Cảnh báo luật NAT mở dải cổng rộng hơn')).toHaveValue('1000');
    expect(screen.getByText(/Mặc định: 1000 cổng/)).toBeInTheDocument();
  });

  it('nhóm Giấy tờ đính kèm (Q-18): ba tham số, nhãn và đơn vị tiếng Việt', async () => {
    renderAt('/admin/settings?group=files');
    expect(await screen.findByRole('button', { name: 'Giấy tờ đính kèm' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Đăng nhập & bảo mật' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { current: 'page' })).toBeNull();
    expect(await screen.findByLabelText('Dung lượng tối đa mỗi file')).toHaveValue('25');
    expect(screen.getByText(/Mặc định: 25 MB/)).toBeInTheDocument();
    expect(screen.getByLabelText('Số file tối đa mỗi lượt chọn')).toHaveValue('6');
    expect(screen.getByText(/Mặc định: 6 file/)).toBeInTheDocument();
    expect(screen.getByLabelText('Gỡ nội dung file đã xóa sau')).toHaveValue('30');
  });

  /* Q-19: mô tả dài vào nút (i) cạnh nhãn, mô tả ngắn vẫn hiện ngay dưới ô. */
  it('mô tả dài hơn ~80 ký tự vào nút (i); mô tả ngắn vẫn hiện', async () => {
    const user = userEvent.setup();
    renderAt('/admin/settings?group=files');
    await screen.findByLabelText('Dung lượng tối đa mỗi file');
    expect(screen.getByText(/Chọn hoặc kéo thả nhiều hơn thì các file dư bị bỏ ra/)).toBeVisible();
    expect(screen.queryByText(/Áp cho mọi loại giấy tờ/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Giải thích: Dung lượng tối đa mỗi file' }));
    expect(await screen.findByText(/Áp cho mọi loại giấy tờ/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Giải thích: Số file tối đa mỗi lượt chọn' })).toBeNull();
    expect(screen.getByText(/Mặc định: 25 MB/)).toBeInTheDocument();
  });

  it('nới quá ngưỡng → cảnh báo; Lưu mở hộp Trước → Sau, chưa gửi gì', async () => {
    const fetchMock = renderAt('/admin/settings');
    const input = await screen.findByLabelText('Số lượt đăng nhập tối đa mỗi IP');
    await userEvent.clear(input);
    await userEvent.type(input, '150');
    expect(screen.getByText(/là nới rất rộng/)).toBeInTheDocument();
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

  it('API từ chối SETTING_OUT_OF_RANGE → lỗi gọi tham số bằng nhãn tiếng Việt, không bằng khóa thô', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'PATCH'
          ? jsonResponse(400, {
              code: 'SETTING_OUT_OF_RANGE',
              message: 'login.rate_limit_per_ip: Phải từ 5 đến 1000.',
            })
          : jsonResponse(200, ROWS),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <ToastProvider>
          <SettingsScreen me={ME} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const input = await screen.findByLabelText('Số lượt đăng nhập tối đa mỗi IP');
    await userEvent.clear(input);
    await userEvent.type(input, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu nhóm này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận đổi tham số' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));
    expect(
      await screen.findByText('Số lượt đăng nhập tối đa mỗi IP: Phải từ 5 đến 1000.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/login\.rate_limit_per_ip/)).not.toBeInTheDocument();
  });

  it('?group=software mở đúng nhóm; 0 = tắt có cảnh báo', async () => {
    renderAt('/admin/settings?group=software');
    const input = await screen.findByLabelText('Ân hạn trước khi tự thanh lý phần mềm');
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    expect(screen.getByText('Đặt 0 là tắt hẳn chức năng này.')).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DeviceForm } from './device-form';
import { DeviceModelField } from './device-model-field';

/** Form thiết bị chọn / tạo model tại chỗ, U trống để chọn (Q-26). */
const LISTS = {
  sites: [{ id: 's1', code: 'HCM', name: 'Văn phòng', address: null, active: true }],
  cabinets: [{ id: 'k1', siteId: 's1', siteCode: 'HCM', code: 'R1', description: null, uHeight: 12, active: true }],
  deviceTypes: [
    { id: 't-sw', name: 'Switch', hasPortMap: true, description: null, active: true },
    { id: 't-pr', name: 'Máy in', hasPortMap: false, description: null, active: true },
  ],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};
const SWITCH = { id: 'm-sw', deviceTypeId: 't-sw', deviceTypeName: 'Switch', model: 'C9300-48P', manufacturer: 'Cisco', rackMountable: true, uSize: 1, photoFrontFileId: null, deviceCount: 2, updatedAt: '2026-10-06T00:00:00Z' };
const PRINTER = { id: 'm-pr', deviceTypeId: 't-pr', deviceTypeName: 'Máy in', model: 'M404', manufacturer: 'HP', rackMountable: false, uSize: null, photoFrontFileId: null, deviceCount: 0, updatedAt: '2026-10-06T00:00:00Z' };
const WITH_PHOTO = { ...SWITCH, id: 'm-ph', model: 'X3650-M5', manufacturer: 'IBM', uSize: 2, photoFrontFileId: 'f-ph', updatedAt: '2026-10-07T01:00:00Z' };
const OCCUPANTS = [{ id: 'x', code: 'SW-E2E-X', name: 'X', cabinetId: 'k1', rackUStart: 3, rackUSize: 1, status: 'in_use' }];

function mockFetch() {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url.startsWith('/api/v1/device-models?')) {
        const term = new URL(url, 'http://x').searchParams.get('search') ?? '';
        return Promise.resolve(jsonResponse(200, { items: [SWITCH, PRINTER, WITH_PHOTO].filter((m) => m.model.toUpperCase().replace(/[\s_.-]/g, '').includes(term.toUpperCase().replace(/[\s_.-]/g, ''))), total: 2 }));
      }
      if (url.startsWith('/api/v1/devices?')) return Promise.resolve(jsonResponse(200, { items: OCCUPANTS, total: 1 }));
      if (url === '/api/v1/devices' && init?.method === 'POST') return Promise.resolve(jsonResponse(201, { device: { id: 'd9', code: 'SW-E2E-9' }, warnings: [] }));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm() {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm device={null} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Form thiết bị — Model (Q-26)', () => {
  it('gõ "c9300 48" ra gợi ý C9300-48P; chọn → Loại khoá theo model, vào tủ thì Số U theo model; U trống bấm là điền; gửi deviceModelId', async () => {
    const calls = mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('combobox', { name: 'Model' }), 'c9300 48');
    await user.click(await screen.findByRole('option', { name: /C9300-48P/ }));
    expect(screen.getByRole('button', { name: 'Loại thiết bị' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Loại thiết bị' })).toHaveTextContent('Switch');
    expect(screen.getByText('Theo model: Cisco · C9300-48P · 1U')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Site' }));
    await user.click(screen.getByRole('option', { name: /HCM/ }));
    await user.click(screen.getByRole('button', { name: 'Tủ mạng' }));
    await user.click(screen.getByRole('option', { name: 'HCM · R1' }));
    const units = screen.getByRole('textbox', { name: 'Số U' });
    expect(units).toHaveValue('1');
    expect(units).toBeDisabled();
    // U3 đã có máy: các dải trống là U1–U2 và U4–U12.
    const free = await screen.findByRole('group', { name: 'U trống:' });
    expect(within(free).getAllByRole('button').map((b) => b.textContent)).toEqual(['U1–U2', 'U4–U12']);
    await user.click(within(free).getByRole('button', { name: 'U4–U12' }));
    expect(screen.getByRole('textbox', { name: 'U bắt đầu' })).toHaveValue('4');
    await user.type(screen.getByRole('textbox', { name: 'Mã thiết bị' }), 'SW-E2E-9');
    await user.type(screen.getByRole('textbox', { name: 'Tên gọi' }), 'Switch tầng 9');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const post = calls.find((c) => c.url === '/api/v1/devices' && c.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ deviceModelId: 'm-sw', deviceTypeId: 't-sw', model: 'C9300-48P', cabinetId: 'k1', rackUStart: 4, rackUSize: 1 });
  });

  it('chọn model có ảnh mặt trước → ô Mặt trước hiện ảnh model ngay (chưa lưu) và khoá tải ảnh riêng; mặt sau vẫn tải được (Q-26 07/10)', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('combobox', { name: 'Model' }), 'x3650');
    await user.click(await screen.findByRole('option', { name: /X3650-M5/ }));
    await userEvent.setup().click(screen.getByRole('button', { name: /^Ảnh và giấy tờ/ }));
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByText('Ảnh chung của model X3650-M5')).toBeInTheDocument();
    expect(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' })).toHaveAttribute('src', '/api/v1/device-models/m-ph/photo/front?v=2026-10-07T01%3A00%3A00Z');
    expect(within(front).queryByLabelText(/Tải ảnh lên|Thay ảnh/)).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Mặt sau' })).getByLabelText('Tải ảnh lên — Mặt sau')).toBeInTheDocument();
  });

  it('gợi ý model có ảnh thu nhỏ (Q-27); chọn xong form hiện dải ảnh mặt trước của model', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('combobox', { name: 'Model' }), 'x3650');
    const option = await screen.findByRole('option', { name: /X3650-M5/ });
    expect(option.querySelector('img')).toHaveAttribute('src', '/api/v1/device-models/m-ph/photo/front?v=2026-10-07T01%3A00%3A00Z');
    await user.click(option);
    expect(screen.getByRole('img', { name: 'Mặt trước model X3650-M5' })).toBeVisible();
  });

  it('model không gắn tủ: không có ô Tủ, nói rõ máy chỉ cần Site', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('combobox', { name: 'Model' }), 'M404');
    await user.click(await screen.findByRole('option', { name: /M404/ }));
    expect(screen.queryByRole('button', { name: 'Tủ mạng' })).toBeNull();
    expect(screen.getByText('Model M404 không gắn tủ — máy chỉ cần Site.')).toBeInTheDocument();
  });

  it('chưa có model: "Tạo model mới" mở hộp tạo model với chữ đang gõ, không rời form', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Mã thiết bị' }), 'FW-E2E-1');
    await user.type(screen.getByRole('combobox', { name: 'Model' }), 'XG-430');
    await user.click(await screen.findByRole('button', { name: 'Tạo model mới "XG-430"' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    expect(within(dialog).getByRole('textbox', { name: /Mã model/ })).toHaveValue('XG-430');
    // Form phía sau bị hộp modal che khỏi cây trợ năng nhưng giữ nguyên chữ đang nhập.
    expect(screen.getByRole('textbox', { name: 'Mã thiết bị', hidden: true })).toHaveValue('FW-E2E-1');
  });

  it('Truy cập quản trị: thêm dòng Web + cổng; dòng bỏ trống địa chỉ không gửi; không có ô mật khẩu', async () => {
    const calls = mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Mã thiết bị' }), 'FW-E2E-2');
    await user.type(screen.getByRole('textbox', { name: 'Tên gọi' }), 'Firewall');
    await user.click(screen.getByRole('button', { name: 'Loại thiết bị' }));
    await user.click(await screen.findByRole('option', { name: 'Switch' }));
    await user.click(screen.getByRole('button', { name: /^Truy cập quản trị/ }));
    await user.click(screen.getByRole('button', { name: '+ Thêm đường truy cập' }));
    await user.type(screen.getByRole('textbox', { name: 'Địa chỉ 1' }), '10.0.1.1');
    await user.type(screen.getByRole('textbox', { name: 'Cổng 1' }), '84a43');
    expect(screen.getByRole('textbox', { name: 'Cổng 1' })).toHaveValue('8443');
    await user.click(screen.getByRole('button', { name: '+ Thêm đường truy cập' }));
    expect(screen.queryByLabelText(/Mật khẩu/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const post = calls.find((c) => c.url === '/api/v1/devices' && c.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}').accessPoints).toEqual([{ kind: 'web', address: '10.0.1.1', port: 8443 }]);
  });

  it('SA/Admin bấm "Tạo model mới" ngay trong form thiết bị → hộp tạo model CÓ ô ảnh mặt trước', async () => {
    mockFetch();
    renderWithI18n(
      <ToastProvider>
        <DeviceModelField csrfToken="t" canManage term="DL380" picked={null} deviceTypeId="t-sw" onPick={() => undefined} onTerm={() => undefined} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Model' }));
    await user.click(await screen.findByRole('button', { name: 'Tạo model mới "DL380"' }));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    expect(within(dialog).getByLabelText('Ảnh mặt trước — tải lên')).toBeInTheDocument();
  });
});

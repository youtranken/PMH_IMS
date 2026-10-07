import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { CropSource } from '@/lib/image-crop';
import { DeviceModelDialog } from './device-model-dialog';

// jsdom không có canvas: nạp ảnh / vẽ ảnh cắt giả lập, tệp ra mang tên "cat-<tên gốc>".
vi.mock('@/lib/image-crop', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/image-crop')>();
  return {
    ...real,
    loadCropSource: vi.fn(async (): Promise<CropSource> => ({ url: 'blob:x', image: {} as HTMLImageElement, size: { width: 1000, height: 100 }, content: { x: 0, y: 0, width: 1000, height: 100 } })),
    renderCrop: vi.fn(async (_s: CropSource, _b: unknown, original: { name: string; type: string }) => new File([new Uint8Array(3)], `cat-${original.name}`, { type: original.type })),
  };
});

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [
    { id: 't-sw', name: 'Switch', active: true },
    { id: 't-pr', name: 'Máy in', active: true },
  ],
};
const EXISTING = { id: 'm1', deviceTypeId: 't-sw', deviceTypeName: 'Switch', model: 'C9300-48P', manufacturer: 'Cisco', rackMountable: true, uSize: 1, photoFrontFileId: null, deviceCount: 3, updatedAt: '2026-10-06T00:00:00Z' };

function mockFetch(post: (body: Record<string, unknown>) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/device-models') && init?.method === 'POST') return Promise.resolve(post(JSON.parse(String(init.body))));
    if (url.endsWith('/api/v1/device-models/m1')) return Promise.resolve(jsonResponse(200, EXISTING));
    return Promise.resolve(jsonResponse(200, LISTS));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Hộp tạo model (Q-26) — dùng ở Danh mục và ngay trong form thiết bị', () => {
  it('model gắn tủ: hỏi Số U; Lưu gửi đủ đặc tính và trả model vừa tạo', async () => {
    const fetchMock = mockFetch((body) => jsonResponse(201, { ...EXISTING, id: 'm2', ...body, deviceTypeName: 'Switch', deviceCount: 0 }));
    const onSaved = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <DeviceModelDialog csrfToken="c" initial={{ model: 'XG-430' }} onClose={() => undefined} onSaved={onSaved} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    expect(within(dialog).getByRole('textbox', { name: /Mã model/ })).toHaveValue('XG-430');
    await user.click(within(dialog).getByRole('button', { name: 'Loại thiết bị' }));
    await user.click(screen.getByRole('option', { name: 'Switch' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Hãng/ }), 'Sophos');
    expect(within(dialog).queryByRole('spinbutton', { name: /Số U/ })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Có' }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /Số U/ }), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/api/v1/device-models') && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ deviceTypeId: 't-sw', model: 'XG-430', manufacturer: 'Sophos', rackMountable: true, uSize: 1, portTemplate: [] });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', model: 'XG-430' })));
  });

  it('trùng khoá chuẩn hoá → báo tại ô Mã model kèm "Dùng model này" (không tạo bản thứ hai)', async () => {
    mockFetch(() =>
      jsonResponse(409, { code: 'DEVICE_MODEL_DUPLICATE', message: 'Đã có model "C9300-48P" — cùng mã sau khi bỏ khoảng trắng, gạch và chữ hoa/thường. Dùng model đó.', existing: { id: 'm1', model: 'C9300-48P' } }),
    );
    const onSaved = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <DeviceModelDialog csrfToken="c" initial={{ model: 'c9300 48p', deviceTypeId: 't-sw' }} onClose={() => undefined} onSaved={onSaved} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    await user.click(within(dialog).getByRole('radio', { name: 'Không' }));
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByText(/Đã có model "C9300-48P"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Dùng model C9300-48P' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', deviceCount: 3 })));
  });

  it('Cổng mẫu: "Switch 48 + 4 uplink" → xem trước 52 cổng và gửi mẫu; dải ngược báo tại chỗ, không gửi', async () => {
    const fetchMock = mockFetch((body) => jsonResponse(201, { ...EXISTING, id: 'm3', ...body, portCount: 52 }));
    renderWithI18n(
      <ToastProvider>
        <DeviceModelDialog csrfToken="c" initial={{ model: 'C9200-48P', deviceTypeId: 't-sw' }} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    await user.click(within(dialog).getByRole('radio', { name: 'Không' }));
    await user.click(within(dialog).getByRole('button', { name: 'Switch 48 + 4 uplink' }));
    expect(within(dialog).getByText('Sinh 52 cổng: Gi1/0/1 … Te1/1/4')).toBeInTheDocument();
    const second = within(dialog).getByRole('textbox', { name: 'Mẫu tên cổng 2' });
    await user.clear(second);
    await user.type(second, 'Te1/1/[[4-1]');
    expect(within(dialog).getByText('Dải [4-1] phải từ số nhỏ tới số lớn.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.clear(second);
    await user.type(second, 'Te1/1/[[1-4]');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body)).portTemplate).toEqual([
      { pattern: 'Gi1/0/[1-48]', kind: 'rj45' },
      { pattern: 'Te1/1/[1-4]', kind: 'sfp+' },
    ]);
  });

  it('SA/Admin tạo model MỚI kèm ảnh: chọn + cắt ngay trong hộp; Lưu tạo model rồi mới tải ảnh lên đúng model đó', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:xem-truoc');
    URL.revokeObjectURL = vi.fn();
    const fetchMock = mockFetch((body) => jsonResponse(201, { ...EXISTING, id: 'm2', ...body, deviceTypeName: 'Switch', deviceCount: 0 }));
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/device-models') && init?.method === 'POST') return Promise.resolve(jsonResponse(201, { ...EXISTING, id: 'm2', model: 'DL380', photoFrontFileId: null }));
      if (url.endsWith('/api/v1/files') && init?.method === 'POST') return Promise.resolve(jsonResponse(201, { id: 'f9' }));
      if (url.endsWith('/api/v1/device-models/m2/photos')) return Promise.resolve(jsonResponse(200, { ...EXISTING, id: 'm2', model: 'DL380', photoFrontFileId: 'f9' }));
      return Promise.resolve(jsonResponse(200, LISTS));
    });
    const onSaved = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <DeviceModelDialog csrfToken="c" canManage initial={{ model: 'DL380', deviceTypeId: 't-sw' }} onClose={() => undefined} onSaved={onSaved} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    await user.click(within(dialog).getByRole('radio', { name: 'Có' }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /Số U/ }), '2');
    await user.upload(within(dialog).getByLabelText('Ảnh mặt trước — tải lên'), new File(['x'], 'dl380.png', { type: 'image/png' }));
    await user.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
    expect(await within(dialog).findByRole('img', { name: 'Ảnh mặt trước của DL380' })).toHaveAttribute('src', 'blob:xem-truoc');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2', photoFrontFileId: 'f9' })));
    const order = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([url]) => String(url));
    expect(order).toEqual(['/api/v1/device-models', '/api/v1/files', '/api/v1/device-models/m2/photos']);
    const upload = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/files'));
    expect((upload?.[1]?.body as FormData).get('ownerId')).toBe('m2');
  });

  it('Thành viên tạo model: không có ô ảnh (ảnh model đổi hình cả loạt máy — chỉ SA/Admin)', async () => {
    mockFetch((body) => jsonResponse(201, body));
    renderWithI18n(
      <ToastProvider>
        <DeviceModelDialog csrfToken="c" initial={{ model: 'DL380' }} onClose={() => undefined} onSaved={() => undefined} />
      </ToastProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Thêm model thiết bị' });
    expect(within(dialog).queryByLabelText('Ảnh mặt trước — tải lên')).toBeNull();
  });
});

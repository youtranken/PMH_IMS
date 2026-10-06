import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { DeviceRow } from '@/lib/device-types';
import { DeviceForm } from './device-form';

/*
 * jsdom không có canvas: hộp cắt ảnh (Q-23) được giả lập trả lại đúng tệp đã chọn, để bài này
 * vẫn kiểm đường tải lên như cũ. Phép cắt có bài riêng ở `ui/image-crop-dialog.test.tsx`.
 */
const held = vi.hoisted(() => ({ file: null as File | null }));
vi.mock('@/lib/image-crop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-crop')>()),
  loadCropSource: vi.fn(async (file: File) => {
    held.file = file;
    return { url: 'blob:x', image: {} as HTMLImageElement, size: { width: 100, height: 100 }, content: { x: 0, y: 0, width: 100, height: 100 } };
  }),
  renderCrop: vi.fn(async () => held.file!),
}));


/**
 * Khu "Ảnh thiết bị" của form (Q-23): thêm mới giữ ảnh ở trình duyệt, máy lưu xong mới tải lên rồi
 * đặt làm ảnh riêng; bước ảnh hỏng thì máy VẪN được tạo và người dùng thấy câu báo + đường đặt lại.
 * Sửa thì ghi thẳng như trang thiết bị.
 */

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [{ id: 't-fw', name: 'Firewall', hasPortMap: false, description: null, active: true }],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

const PHOTOS = (front: string | null) => ({
  device: { front: front ? { id: front, name: 'mat-truoc.png' } : null, back: null },
  model: null,
  effective: { front: front ? { id: front, name: 'mat-truoc.png' } : null, back: null },
});

function mockFetch({ uploadFails = false } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (url.startsWith('/api/v1/catalog/device-types')) return Promise.resolve(jsonResponse(200, { svg: null }));
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url === '/api/v1/devices' && method === 'POST') {
        return Promise.resolve(jsonResponse(201, { device: { id: 'd1', code: 'FW-E2E-01' }, warnings: [] }));
      }
      if (url === '/api/v1/files' && method === 'POST') {
        return Promise.resolve(uploadFails ? jsonResponse(400, { message: 'Tệp ảnh hỏng.' }) : jsonResponse(201, { id: 'f-new' }));
      }
      if (url.endsWith('/devices/d1/photos') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { front?: string | null };
        return Promise.resolve(jsonResponse(200, PHOTOS(body.front ?? null)));
      }
      if (url.endsWith('/devices/d1/photos')) return Promise.resolve(jsonResponse(200, PHOTOS(null)));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm(device: DeviceRow | null, handlers: { onSaved?: () => void; onOpenCreated?: () => void } = {}) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm
          device={device}
          csrfToken="t"
          onClose={() => {}}
          onSaved={handlers.onSaved ?? (() => {})}
          onOpenCreated={handlers.onOpenCreated}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Mã thiết bị' }), 'FW-E2E-01');
  await user.type(screen.getByRole('textbox', { name: 'Tên thiết bị' }), 'Tường lửa E2E');
  await user.click(screen.getByRole('button', { name: 'Loại' }));
  await user.click(await screen.findByRole('option', { name: 'Firewall' }));
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:xem-truoc'), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Form thiết bị — khu "Ảnh thiết bị"', () => {
  it('thêm mới: chọn ảnh → xem trước ngay, chưa gửi gì; Lưu → tạo máy rồi tải ảnh lên giấy tờ của máy và đặt làm ảnh riêng', async () => {
    const calls = mockFetch();
    const onSaved = vi.fn();
    renderForm(null, { onSaved });
    const user = userEvent.setup();
    await fillRequired(user);

    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByText(/Chưa chọn ảnh/)).toBeInTheDocument();
    // Loại vừa chọn hiện thành biểu tượng lớn trong ô trống.
    expect(within(front).getByRole('img', { name: 'Biểu tượng loại Firewall' })).toBeInTheDocument();
    await user.upload(within(front).getByLabelText('Tải ảnh lên — Mặt trước'), new File(['x'], 'mat-truoc.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
    expect(within(front).getByText('Ảnh riêng — tải lên khi lưu máy')).toBeInTheDocument();
    expect(within(front).getByRole('img', { name: 'Ảnh Mặt trước đã chọn' })).toHaveAttribute('src', 'blob:xem-truoc');
    expect(calls.some((c) => c.url === '/api/v1/files')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/devices/d1/photos') && c.method === 'PATCH')).toBe(true));
    const order = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(order).toEqual(['POST /api/v1/devices', 'POST /api/v1/files', 'PATCH /api/v1/devices/d1/photos']);
    const upload = calls.find((c) => c.url === '/api/v1/files');
    expect((upload?.body as FormData).get('ownerType')).toBe('device');
    expect((upload?.body as FormData).get('ownerId')).toBe('d1');
    expect(JSON.parse(String(calls.find((c) => c.method === 'PATCH')?.body))).toEqual({ front: 'f-new' });
    expect(await screen.findByText('Đã đặt ảnh cho máy FW-E2E-01.')).toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('bỏ ảnh đã chọn → không tải gì khi lưu', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await fillRequired(user);
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    await user.upload(within(front).getByLabelText('Tải ảnh lên — Mặt trước'), new File(['x'], 'a.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await user.click(within(front).getByRole('button', { name: 'Bỏ ảnh đã chọn — Mặt trước' }));
    expect(within(front).getByText(/Chưa chọn ảnh/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/devices' && c.method === 'POST')).toBe(true));
    expect(calls.some((c) => c.url === '/api/v1/files')).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/photos') && c.method === 'PATCH')).toBe(false);
  });

  it('bước ảnh hỏng: máy VẪN được tạo, câu báo nói rõ + nút mở hồ sơ để đặt lại ảnh', async () => {
    mockFetch({ uploadFails: true });
    const onSaved = vi.fn();
    const onOpenCreated = vi.fn();
    renderForm(null, { onSaved, onOpenCreated });
    const user = userEvent.setup();
    await fillRequired(user);
    await user.upload(screen.getByLabelText('Tải ảnh lên — Mặt trước'), new File(['x'], 'a.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText(/Đã thêm máy FW-E2E-01 nhưng chưa đặt được ảnh \(Tệp ảnh hỏng\.\)/)).toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Hộp form còn mở trong bài này (nơi gọi thật đóng nó ở onSaved) nên nền bị khoá chuột.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole('button', { name: 'Mở hồ sơ đặt lại ảnh' }));
    expect(onOpenCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
  });

  it('sửa: ô ảnh ghi thẳng (không chờ Lưu)', async () => {
    const calls = mockFetch();
    renderForm({ id: 'd1', code: 'FW-E2E-01', name: 'Tường lửa', deviceTypeId: 't-fw', deviceTypeName: 'Firewall', status: 'in_use' } as DeviceRow);
    const front = await screen.findByRole('group', { name: 'Mặt trước' });
    await within(front).findByText('Biểu tượng loại Firewall');
    await userEvent.setup().upload(within(front).getByLabelText('Tải ảnh lên — Mặt trước'), new File(['x'], 'mat-truoc.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
    expect(await within(front).findByText('Ảnh riêng của máy này')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/devices/d1') && c.method === 'PATCH')).toBe(false);
  });
});

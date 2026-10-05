import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { DeviceDiagramLook, lookLevel } from './device-diagram-look';
import { RelationMap } from './relation-map';

/**
 * "Hình dùng trên sơ đồ" (Q-23 05/10): mỗi máy đổi được ảnh của riêng nó; thứ tự tra ảnh riêng →
 * ảnh model → biểu tượng loại là của server (`effective`), web chỉ nói mức nào đang dùng.
 */

const PHOTOS = (own: boolean, model: boolean) => ({
  device: { front: own ? { id: 'f-own', name: 'rieng.png' } : null, back: null },
  model: { id: 'm1', label: 'C9300', front: model ? { id: 'f-model', name: 'model.png' } : null, back: null },
  effective: { front: own ? { id: 'f-own', name: 'rieng.png' } : model ? { id: 'f-model', name: 'model.png' } : null, back: null },
});

describe('lookLevel — mức ảnh đang dùng', () => {
  it.each([
    [true, true, 'own'],
    [false, true, 'model'],
    [false, false, 'icon'],
    [true, false, 'own'],
  ] as const)('riêng=%s model=%s → %s', (own, model, want) => {
    expect(lookLevel(PHOTOS(own, model), 'front')).toBe(want);
  });
  it('chưa tải → icon', () => {
    expect(lookLevel(undefined, 'front')).toBe('icon');
  });
});

function mockFetch(state: { own: boolean; model: boolean }) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body });
      if (url.endsWith('/api/v1/files') && method === 'POST') return Promise.resolve(jsonResponse(201, { id: 'f-new' }));
      if (url.endsWith('/devices/d1/photos') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { front?: string | null };
        state.own = Boolean(body.front);
        return Promise.resolve(jsonResponse(200, PHOTOS(state.own, state.model)));
      }
      if (url.endsWith('/devices/d1/model') && method === 'POST') return Promise.resolve(jsonResponse(201, { id: 'm1', label: 'C9300' }));
      if (url.endsWith('/devices/d1/model-photos') && method === 'PATCH') {
        state.model = true;
        return Promise.resolve(jsonResponse(200, PHOTOS(state.own, state.model)));
      }
      if (url.endsWith('/devices/d1/photos')) return Promise.resolve(jsonResponse(200, PHOTOS(state.own, state.model)));
      return Promise.resolve(jsonResponse(404, {}));
    }),
  );
  return calls;
}

function renderLook(canEditModel: boolean) {
  return renderWithI18n(
    <ToastProvider>
      <DeviceDiagramLook deviceId="d1" deviceTypeName="Switch" csrfToken="t" canEdit canEditModel={canEditModel} />
    </ToastProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('DeviceDiagramLook — khu "Hình dùng trên sơ đồ"', () => {
  it('đang dùng ảnh model: nói rõ mức + ảnh xem trước; tải ảnh riêng → lên giấy tờ của máy rồi chọn làm ảnh riêng', async () => {
    const calls = mockFetch({ own: false, model: true });
    renderLook(false);
    const front = await screen.findByRole('group', { name: 'Mặt trước' });
    expect(await within(front).findByText('Ảnh chung của model C9300')).toBeInTheDocument();
    expect(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' })).toHaveAttribute('src', '/api/v1/devices/d1/photo/front?v=f-model');
    expect(screen.getByText(/dùng cho MỌI máy cùng loại \+ model/)).toBeInTheDocument();
    // Thành viên không đổi ảnh model.
    expect(within(front).queryByLabelText('Dùng cho mọi máy cùng model — Mặt trước')).toBeNull();
    const user = userEvent.setup();
    await user.upload(within(front).getByLabelText('Tải ảnh riêng — Mặt trước'), new File(['x'], 'rieng.png', { type: 'image/png' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/devices/d1/photos') && c.method === 'PATCH')).toBe(true));
    const upload = calls.find((c) => c.url.endsWith('/api/v1/files'));
    expect((upload?.body as FormData).get('ownerType')).toBe('device');
    expect(JSON.parse(String(calls.find((c) => c.method === 'PATCH')?.body))).toEqual({ front: 'f-new' });
    expect(await within(front).findByText('Ảnh riêng của máy này')).toBeInTheDocument();
  });

  it('có ảnh riêng: "Bỏ ảnh riêng" gửi null, về ảnh model', async () => {
    const calls = mockFetch({ own: true, model: true });
    renderLook(false);
    const front = await screen.findByRole('group', { name: 'Mặt trước' });
    await within(front).findByText('Ảnh riêng của máy này');
    await userEvent.setup().click(within(front).getByRole('button', { name: 'Bỏ ảnh riêng — Mặt trước' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.method === 'PATCH')?.body))).toEqual({ front: null });
    expect(await within(front).findByText('Ảnh chung của model C9300')).toBeInTheDocument();
  });

  it('không ảnh nào → "Biểu tượng loại Switch"; SA/Admin tải ảnh model: tạo hàng model, tải lên model, chọn', async () => {
    const calls = mockFetch({ own: false, model: false });
    renderLook(true);
    const front = await screen.findByRole('group', { name: 'Mặt trước' });
    expect(await within(front).findByText('Biểu tượng loại Switch')).toBeInTheDocument();
    expect(within(front).queryByRole('img')).toBeNull();
    await userEvent.setup().upload(within(front).getByLabelText('Dùng cho mọi máy cùng model — Mặt trước'), new File(['x'], 'model.png', { type: 'image/png' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/model-photos'))).toBe(true));
    expect(calls.some((c) => c.url.endsWith('/devices/d1/model') && c.method === 'POST')).toBe(true);
    expect((calls.find((c) => c.url.endsWith('/api/v1/files'))?.body as FormData).get('ownerType')).toBe('device_model');
    expect(await within(front).findByText('Ảnh chung của model C9300')).toBeInTheDocument();
  });
});

describe('Bản đồ quan hệ dùng cùng ảnh', () => {
  it('hubImage → <img> trỏ endpoint ảnh đã thu nhỏ trong hạch; không có thì không có ảnh', () => {
    const node = { key: 'p', title: 'Cổng', count: 1, icon: 'port' as const, lines: [], cut: false, onOpen: () => undefined };
    const { unmount } = renderWithI18n(<RelationMap hubCode="SW-E2E-01" nodes={[node]} missing={[]} hubImage={{ src: '/api/v1/devices/d1/photo/front?v=f-own', alt: 'Ảnh SW-E2E-01' }} />);
    const hub = screen.getByTestId('rmap-hub');
    expect(within(hub).getByRole('img', { name: 'Ảnh SW-E2E-01' })).toHaveAttribute('src', '/api/v1/devices/d1/photo/front?v=f-own');
    expect(hub).toHaveTextContent('SW-E2E-01');
    unmount();
    renderWithI18n(<RelationMap hubCode="SW-E2E-01" nodes={[node]} missing={[]} />);
    expect(within(screen.getByTestId('rmap-hub')).queryByRole('img')).toBeNull();
  });
});

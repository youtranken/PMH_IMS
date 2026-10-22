import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DevicesScreen } from './devices-screen';

/**
 * UX-E25: nhân viên nghỉ phải đổi người dùng cho cả chục máy, hay cả phòng máy hỏng một lượt —
 * tick nhiều dòng rồi làm một lần, thay vì mở từng hồ sơ.
 */
const ME = { role: 'member', csrfToken: 't', email: 'm@pmh.com.vn' } as unknown as Me;

function row(id: string, code: string) {
  return {
    id, code, name: `Máy ${code}`, deviceTypeId: 't1', deviceTypeName: 'PC', hasPortMap: false,
    model: null, serial: null, siteId: null, siteCode: null, cabinetId: null, cabinetCode: null,
    vendorId: null, vendorName: null, assignedTo: 'An', department: 'IT', purchaseDate: null,
    warrantyStart: null, warrantyEnd: null, status: 'in_use', note: null,
    deviceModelId: null, modelPhotoVersion: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function setup() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(jsonResponse(201, url.endsWith('/status') ? { changed: 2 } : { updated: 2 }));
      }
      if (url.startsWith('/api/v1/devices?')) return Promise.resolve(jsonResponse(200, { items: [row('d1', 'PC-01'), row('d2', 'PC-02')], total: 2 }));
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  renderWithI18n(
    <MemoryRouter initialEntries={['/devices']}>
      <ToastProvider>
        <ConfirmProvider>
          <DevicesScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Thiết bị — thao tác hàng loạt', () => {
  it('tick hai máy → thanh "Đã chọn 2"; Đổi trạng thái → Hỏng gửi một lượt POST /devices/bulk/status', async () => {
    const calls = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Chọn PC-01' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn PC-02' }));
    const bar = screen.getByRole('group', { name: 'Thao tác với các máy đã chọn' });
    expect(bar).toHaveTextContent('Đã chọn 2');
    await user.click(within(bar).getByRole('button', { name: 'Đổi trạng thái' }));
    // Cùng hộp Đổi trạng thái của từng máy — không có Thanh lý (thanh lý làm từng máy).
    const dialog = await screen.findByRole('dialog', { name: 'Đổi trạng thái — 2 Máy' });
    await user.click(within(dialog).getByRole('button', { name: 'Trạng thái mới' }));
    expect(screen.queryByRole('option', { name: 'Đã thanh lý' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Hỏng' }));
    await user.click(within(dialog).getByRole('button', { name: 'Đổi trạng thái' }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: '/api/v1/devices/bulk/status', body: { ids: ['d1', 'd2'], status: 'broken' } });
  });

  it('Đổi người dùng / phòng ban: gửi ids + ô đã điền; làm xong thì bỏ chọn, thanh biến mất', async () => {
    const calls = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Chọn PC-01' }));
    const bar = screen.getByRole('group', { name: 'Thao tác với các máy đã chọn' });
    await user.click(within(bar).getByRole('button', { name: 'Đổi người dùng / phòng ban' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đổi người dùng / phòng ban — 1 Máy' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Người dùng' }), 'Bình');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: '/api/v1/devices/bulk/update', body: { ids: ['d1'], assignedTo: 'Bình' } });
    // Làm xong thì bỏ chọn: thanh biến mất, không ai bấm nhầm lần hai lên lô cũ.
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Thao tác với các máy đã chọn' })).toBeNull());
  });
});

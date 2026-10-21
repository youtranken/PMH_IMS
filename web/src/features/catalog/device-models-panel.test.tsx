import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DeviceModelsPanel } from './device-models-panel';

const meOf = (role: string) => ({ id: 'u1', email: `${role}@e2e.local`, fullName: role, role, csrfToken: 'c' }) as unknown as Me;
const MODELS = [
  { id: 'm1', deviceTypeId: 't-sw', deviceTypeName: 'Switch', model: 'C9300-48P', manufacturer: 'Cisco', rackMountable: true, uSize: 1, photoFrontFileId: 'f1', deviceCount: 3, unlinkedCount: 2, updatedAt: '2026-10-06T00:00:00Z' },
  { id: 'm2', deviceTypeId: 't-pr', deviceTypeName: 'Máy in', model: 'M404', manufacturer: null, rackMountable: false, uSize: null, photoFrontFileId: null, deviceCount: 0, unlinkedCount: 0, updatedAt: '2026-10-06T00:00:00Z' },
];

function mockFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/v1/device-models/m1') && init?.method === 'DELETE') {
      return Promise.resolve(jsonResponse(409, { code: 'DEVICE_MODEL_IN_USE', message: 'Model còn 3 máy dùng — gán model khác cho các máy đó trước khi xoá.' }));
    }
    if (url === '/api/v1/device-models/m1/adopt' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse(200, { linked: ['SW-E2E-1'], skipped: [{ code: 'SW-E2E-2', reason: 'U5 đã có máy SW-E2E-9.' }] }));
    }
    if (url.startsWith('/api/v1/device-models?')) return Promise.resolve(jsonResponse(200, { items: MODELS, total: 2 }));
    return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(role: string) {
  return renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <DeviceModelsPanel me={meOf(role)} adding={false} onAddingChange={() => undefined} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Danh mục → Model thiết bị (Q-26)', () => {
  it('cột Hãng, Mã model, Loại, Gắn tủ (n U / Không gắn tủ), số máy bấm ra danh sách máy, ảnh hoặc "Chưa có ảnh"', async () => {
    mockFetch();
    renderPanel('sa');
    const row = (await screen.findByText('C9300-48P')).closest('tr')!;
    expect(within(row).getByText('Cisco')).toBeInTheDocument();
    expect(within(row).getByText('1U')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: '3 máy' })).toHaveAttribute('href', '/devices?search=C9300-48P');
    expect(within(row).getByRole('img', { name: 'Ảnh mặt trước của C9300-48P' })).toHaveAttribute('src', expect.stringContaining('/api/v1/device-models/m1/photo/front'));
    const other = screen.getByText('M404').closest('tr')!;
    expect(within(other).getByText('Không gắn tủ')).toBeInTheDocument();
    expect(within(other).getByText('Chưa có ảnh')).toBeInTheDocument();
    expect(within(other).getByText('0 máy')).toBeInTheDocument();
  });

  it('Thành viên: có lời giải thích, không có Sửa / Xóa trong menu dòng', async () => {
    mockFetch();
    renderPanel('member');
    const row = (await screen.findByText('C9300-48P')).closest('tr')!;
    expect(screen.getByText('Sửa, xóa, đổi ảnh model do Super Admin / Quản trị làm.')).toBeInTheDocument();
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Việc với model C9300-48P' }));
    expect(screen.queryByRole('menuitem', { name: 'Sửa' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Xóa' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Xem các máy' })).toBeInTheDocument();
  });

  it('SA xóa model còn máy dùng: hỏi trước, server từ chối 409 → báo đúng lời server', async () => {
    const fetchMock = mockFetch();
    renderPanel('sa');
    const user = userEvent.setup();
    const row = (await screen.findByText('C9300-48P')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Việc với model C9300-48P' }));
    await user.click(screen.getByRole('menuitem', { name: 'Xóa' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xóa model C9300-48P?' });
    await user.click(within(confirm).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText(/Model còn 3 máy dùng/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/device-models/m1') && init?.method === 'DELETE')).toBe(true);
  });

  it('máy ghi CHỮ model mà chưa gán: cột Máy nói rõ; SA "Gán model cho n máy" → hỏi → gán, báo số đã gán và máy không gán được kèm lý do (Q-26 07/10)', async () => {
    const fetchMock = mockFetch();
    renderPanel('sa');
    const row = (await screen.findByText('C9300-48P')).closest('tr')!;
    expect(within(row).getByText('2 máy ghi chữ này chưa gán')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Việc với model C9300-48P' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Gán model cho 2 máy ghi chữ này' }));
    const ask = await screen.findByRole('dialog', { name: 'Gán model C9300-48P cho 2 máy?' });
    await user.click(within(ask).getByRole('button', { name: 'Gán model' }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/device-models/m1/adopt' && init?.method === 'POST')).toBe(true);
    expect(await screen.findByText('Đã gán model C9300-48P cho 1 máy.')).toBeInTheDocument();
    expect(await screen.findByText('Chưa gán được: SW-E2E-2 (U5 đã có máy SW-E2E-9.)')).toBeInTheDocument();
  });

  it('Thành viên không có việc gán hàng loạt', async () => {
    mockFetch();
    renderPanel('member');
    const row = (await screen.findByText('C9300-48P')).closest('tr')!;
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Việc với model C9300-48P' }));
    expect(screen.queryByRole('menuitem', { name: /Gán model/ })).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { DeviceRow } from '@/lib/device-types';
import { DeviceForm } from './device-form';

/**
 * Vị trí U tự giải thích (Q-23 05/10): câu sống dưới ô U, kiểm chồng U với máy đang ở tủ TRƯỚC khi
 * lưu, lỗi chồng U của server gắn vào ô "U bắt đầu", và "Xem tủ" mở mặt đứng của tủ — bấm U trống
 * là điền "U bắt đầu".
 */

const LISTS = {
  sites: [{ id: 's-on', code: 'HCM', name: 'Văn phòng', address: null, active: true }],
  cabinets: [{ id: 'c-1', siteId: 's-on', siteCode: 'HCM', code: 'R1', description: null, uHeight: 12, active: true }],
  deviceTypes: [{ id: 't-on', name: 'PC', hasPortMap: false, description: null, active: true }],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

const OCCUPANTS = [
  { id: 'sw', code: 'SW-E2E-01', name: 'Switch', cabinetId: 'c-1', rackUStart: 10, rackUSize: 1, status: 'in_use' },
  { id: 'srv', code: 'SRV-E2E-01', name: 'Máy chủ', cabinetId: 'c-1', rackUStart: 3, rackUSize: 2, status: 'in_use' },
  { id: 'd1', code: 'PC-E2E-01', name: 'Máy này', cabinetId: 'c-1', rackUStart: 6, rackUSize: 1, status: 'in_use' },
];

const ME_DEVICE = {
  id: 'd1',
  code: 'PC-E2E-01',
  name: 'Máy này',
  deviceTypeId: 't-on',
  siteId: 's-on',
  cabinetId: 'c-1',
  rackUStart: 6,
  rackUSize: 1,
  status: 'in_use',
} as DeviceRow;

function mockFetch(patch: () => Response = () => jsonResponse(200, { device: { id: 'd1', code: 'PC-E2E-01' }, warnings: [] })) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url.startsWith('/api/v1/devices?')) return Promise.resolve(jsonResponse(200, { items: OCCUPANTS, total: OCCUPANTS.length }));
      if (init?.method === 'PATCH') return Promise.resolve(patch());
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm(device: DeviceRow = ME_DEVICE) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DeviceForm device={device} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Vị trí U tự giải thích', () => {
  it('câu sống dưới ô: 1U → "Thiết bị nằm ở U6"; 2U → "Chiếm U6–U7 (U1 ở đáy tủ, máy chiếm lên trên)"', async () => {
    mockFetch();
    renderForm();
    expect(await screen.findByText('Thiết bị nằm ở U6.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tăng số U' }));
    expect(screen.getByText('Chiếm U6–U7 (U1 ở đáy tủ, máy chiếm dần lên trên).')).toBeInTheDocument();
  });

  it('chồng U với máy đang ở tủ → báo NGAY tại ô "U bắt đầu", Lưu không gửi', async () => {
    const calls = mockFetch();
    renderForm();
    const user = userEvent.setup();
    const start = await screen.findByRole('textbox', { name: 'U bắt đầu' });
    await user.clear(start);
    await user.type(start, '10');
    expect(await screen.findByText('U10 đang có SW-E2E-01 — chọn U khác (bấm "Xem tủ" để thấy chỗ trống).')).toBeInTheDocument();
    expect(start).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('server vẫn là trọng tài: lỗi chồng U của server gắn vào ô "U bắt đầu"', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, code: 'DEVICE_RACK_U_TAKEN', message: 'U8 trong tủ đang có AP-E2E (AP) chiếm — hai máy không chồng U trong cùng tủ.' }));
    renderForm();
    const user = userEvent.setup();
    const start = await screen.findByRole('textbox', { name: 'U bắt đầu' });
    await user.clear(start);
    await user.type(start, '8');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(start).toHaveAttribute('aria-invalid', 'true'));
    expect(start).toHaveAccessibleDescription(/U8 trong tủ đang có AP-E2E/);
  });

  it('"Xem tủ": mặt đứng U12 → U1, máy chiếm đúng U (2U chiếm 2 dòng), bấm U trống thì điền "U bắt đầu"', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Xem tủ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tủ HCM · R1 (12U)' });
    const rack = within(dialog).getByRole('list', { name: 'Các U của tủ HCM · R1' });
    const rows = within(rack).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveTextContent('U12');
    expect(rows[2]).toHaveTextContent('U10SW-E2E-01');
    expect(rows[8]).toHaveTextContent('U4SRV-E2E-01');
    expect(rows[9]).toHaveTextContent('U3SRV-E2E-01');
    expect(rows[6]).toHaveTextContent('U6PC-E2E-01 (máy này)');
    await user.click(within(rack).getByRole('button', { name: 'Đặt máy ở U8' }));
    expect(screen.queryByRole('dialog', { name: 'Tủ HCM · R1 (12U)' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'U bắt đầu' })).toHaveValue('8');
  });
});

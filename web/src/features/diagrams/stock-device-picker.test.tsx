import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { StockDevicePicker } from './stock-device-picker';

const device = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
  id,
  code,
  name: `Máy ${code}`,
  status: 'in_use',
  deviceTypeName: 'Switch',
  siteCode: 'TOWER',
  cabinetCode: 'TU-01',
  cabinetId: 'k1',
  rackUStart: 1,
  rackUSize: 1,
  ...extra,
});

const look = (id: string, photo: boolean) => ({
  id,
  found: true,
  icon: 'shape=mxgraph.cisco.switch;',
  iconAspect: 0.5,
  front: photo ? { style: 'shape=image;image=data:image/png;base64,iVBOR;imageAspect=1;', fileId: `f-${id}`, aspect: 0.1 } : null,
  back: null,
});

function mockFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/v1/devices?')) {
      return Promise.resolve(
        jsonResponse(200, {
          items: [device('d1', 'SW-READY'), device('d2', 'SW-NOU', { rackUStart: null }), device('d3', 'PC-NOPHOTO', { cabinetId: null, cabinetCode: null, rackUStart: null })],
          total: 3,
        }),
      );
    }
    if (url.startsWith('/api/v1/diagrams/device-looks?')) {
      return Promise.resolve(jsonResponse(200, { items: [look('d1', true), look('d2', true), look('d3', false)] }));
    }
    return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Thiết bị kho — huy hiệu sẵn sàng (Q-23 06/10 chiều)', () => {
  it('máy trong tủ thiếu U → "Thiếu U"; không có ảnh → "Chưa có ảnh"; kèm cách sửa + Mở hồ sơ ở tab mới; không chặn tick', async () => {
    const fetchMock = mockFetch();
    renderWithI18n(<StockDevicePicker present={new Set()} busy={false} onInsert={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Thiết bị trong kho' });
    const row = (code: string) => within(list).getByText(code).closest('li')!;
    await within(list).findByText('SW-NOU');

    expect(await within(row('SW-NOU')).findByText('Thiếu U')).toHaveAttribute('title', expect.stringContaining('khai U'));
    expect(within(row('PC-NOPHOTO')).getByText('Chưa có ảnh')).toBeInTheDocument();
    expect(within(row('SW-READY')).queryByText('Thiếu U')).toBeNull();
    expect(within(row('SW-READY')).queryByText('Chưa có ảnh')).toBeNull();
    const open = within(row('SW-NOU')).getByRole('link', { name: 'Mở hồ sơ SW-NOU' });
    expect(open).toHaveAttribute('href', '/devices/d2');
    expect(open).toHaveAttribute('target', '_blank');
    // Chỉ báo, không chặn.
    expect(within(row('SW-NOU')).getByRole('checkbox')).toBeEnabled();
    // Một lượt hỏi ảnh cho cả danh sách, không N lượt.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/device-looks?'))).toHaveLength(1);
  });

  it('"Chỉ máy cần xử lý" lọc ra máy có huy hiệu', async () => {
    mockFetch();
    renderWithI18n(<StockDevicePicker present={new Set()} busy={false} onInsert={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Thiết bị trong kho' });
    await within(list).findByText('Thiếu U');
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Chỉ máy cần xử lý' }));
    expect(within(list).queryByText('SW-READY')).toBeNull();
    expect(within(list).getByText('SW-NOU')).toBeInTheDocument();
    expect(within(list).getByText('PC-NOPHOTO')).toBeInTheDocument();
  });
});

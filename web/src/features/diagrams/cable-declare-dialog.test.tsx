import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import type { PortMap } from '@/lib/port-types';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { CableDeclareDialog } from './cable-declare-dialog';

/**
 * Nối máy THỨ BA vào một máy đã có dây (góp ý chủ dự án, Q-23): không cần khai số cổng — gõ tên cổng
 * mới là tạo; gõ lại cổng đã có cáp thì báo NGAY tại ô, kèm nút dùng cổng trống kế tiếp, thay vì
 * để người vẽ bấm Khai rồi nhận một câu 409 chung chung.
 */

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const EDGE = { id: 'e2', sourceCellId: 'c', targetCellId: 'a', sourceDeviceId: 'dev-c', sourceCode: 'PC-E2E-C', targetDeviceId: 'dev-a', targetCode: 'SW-E2E-A' };
const row = (portLabel: string, extra: Partial<PortMap['ports'][number]> = {}) => ({
  id: `p-${portLabel}`,
  portLabel,
  connectedDeviceId: null,
  connectedDeviceCode: null,
  connectedDeviceName: null,
  connectedLabel: null,
  connectedPort: null,
  usedBy: null,
  vlan: null,
  note: null,
  ...extra,
});
/** SW đã nối cổng 1 sang PC-B (dòng của SW). PC-C chưa khai cổng nào. */
const SW_PORTS: PortMap = { ports: [row('1', { connectedDeviceId: 'dev-b', connectedDeviceCode: 'PC-E2E-B', connectedPort: '1' })], incoming: [] };
const PC_PORTS: PortMap = { ports: [], incoming: [] };

function mockFetch(link: () => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/ports/link')) return Promise.resolve(link());
    if (url.includes('/dev-a/ports')) return Promise.resolve(jsonResponse(200, SW_PORTS));
    if (url.includes('/dev-c/ports')) return Promise.resolve(jsonResponse(200, PC_PORTS));
    if (url.includes('/diagrams/links')) return Promise.resolve(jsonResponse(200, [{ id: 'l2', deviceId: 'dev-c', deviceCode: 'PC-E2E-C', portLabel: '1', peerDeviceId: 'dev-a', peerDeviceCode: 'SW-E2E-A', peerPort: '2' }]));
    return Promise.resolve(jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function open(onDeclared = vi.fn()) {
  renderWithI18n(<CableDeclareDialog me={ME} edge={EDGE} cableTypes={[]} onDeclared={onDeclared} onBind={vi.fn()} onDrawOnly={vi.fn()} />);
  return screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
}

afterEach(() => vi.unstubAllGlobals());

describe('Hộp Khai — cổng đang dùng, trùng cổng báo tại ô', () => {
  it('máy chưa khai cổng nào: nói rõ gõ tên mới là được; máy đã có dây: liệt kê cổng đang dùng', async () => {
    mockFetch(() => jsonResponse(201, { id: 'l2' }));
    const dialog = await open();
    expect(await within(dialog).findByText('PC-E2E-C chưa khai cổng nào — gõ tên cổng mới (vd Gi1/0/1), cổng được tạo khi bấm Khai.')).toBeInTheDocument();
    expect(await within(dialog).findByText('Cổng đang dùng của SW-E2E-A: 1 → PC-E2E-B')).toBeInTheDocument();
  });

  it('gõ cổng đã có cáp → lỗi ngay tại ô, Khai không gọi API; "Dùng cổng 2" điền cổng trống kế tiếp rồi khai được', async () => {
    const fetchMock = mockFetch(() => jsonResponse(201, { id: 'l2' }));
    const onDeclared = vi.fn();
    const dialog = await open(onDeclared);
    const user = userEvent.setup();
    await within(dialog).findByText('Cổng đang dùng của SW-E2E-A: 1 → PC-E2E-B');
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của PC-E2E-C' }), '1');
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-A' }), '1');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Cổng 1 của SW-E2E-A đã nối PC-E2E-B — mỗi cổng một sợi cáp.');
    await user.click(within(dialog).getByRole('button', { name: 'Khai' }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ports/link'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Dùng cổng 2 cho SW-E2E-A' }));
    expect(within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-A' })).toHaveValue('2');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Khai' }));
    await vi.waitFor(() => expect(onDeclared).toHaveBeenCalled());
  });

  it('409 của server (cổng đầu kia vừa bị chiếm) gắn vào ô của máy đó, không thành câu chung đầu hộp', async () => {
    mockFetch(() => jsonResponse(409, { statusCode: 409, code: 'PORT_PEER_TAKEN', message: 'Cổng "7" của SW-E2E-A đã có cáp nối từ AP-E2E cổng "1".' }));
    const dialog = await open();
    const user = userEvent.setup();
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của PC-E2E-C' }), '1');
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-A' }), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Khai' }));
    const peerField = within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-A' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cổng "7" của SW-E2E-A đã có cáp');
    expect(peerField).toHaveAttribute('aria-invalid', 'true');
  });
});

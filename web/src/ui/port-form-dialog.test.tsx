import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { PortFormDialog } from '@/ui/port-form-dialog';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';

/*
 * Dấu tích "đã lưu" trên nút Lưu chỉ thuộc về lượt bấm CHÍNH nút đó. Bấm "Ghi rồi khai cổng kế
 * tiếp" thì hộp ở lại để khai cổng sau — dấu tích nhảy lên nút Lưu đọc ra là đã lưu và đóng.
 */

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { portLabel: string };
        return Promise.resolve(
          jsonResponse(200, {
            id: 'p1',
            portLabel: body.portLabel,
            connectedDeviceId: null,
            connectedDeviceCode: null,
            connectedDeviceName: null,
            connectedLabel: null,
            connectedPort: null,
            usedBy: null,
            vlan: null,
            note: null,
          }),
        );
      }
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(
          jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: [] }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
}

const portInput = () => document.getElementById('port-label') as HTMLInputElement;

function renderDialog() {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <PortFormDialog device={{ id: 'd1', code: 'SW-E2E-01' }} port={null} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('PortFormDialog — dấu tích ở đúng nút vừa bấm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.motion;
  });

  it('"Ghi rồi khai cổng kế tiếp" → nút Lưu KHÔNG hiện dấu tích', async () => {
    document.documentElement.dataset.motion = 'on';
    mockFetch();
    renderDialog();
    const user = userEvent.setup();
    await user.type(portInput(), 'Gi1/0/1');
    await user.click(screen.getByRole('button', { name: 'Ghi rồi khai cổng kế tiếp' }));
    await waitFor(() => expect(portInput()).toHaveValue('Gi1/0/2'));
    expect(screen.getByRole('button', { name: /^Lưu$/ })).not.toHaveAttribute('data-done');
  });

  it('vế đối chứng: bấm Lưu → nút Lưu hiện dấu tích', async () => {
    document.documentElement.dataset.motion = 'on';
    mockFetch();
    renderDialog();
    const user = userEvent.setup();
    await user.type(portInput(), 'Gi1/0/1');
    await user.click(screen.getByRole('button', { name: /^Lưu$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Lưu$/ })).toHaveAttribute('data-done', 'true'));
  });
});

/**
 * E-05: hộp "Khai kết nối" mở từ màn sơ đồ biết bản vẽ đang mở — máy trên bản vẽ chọn được ngay,
 * hai đầu tách thành "Đầu A" / "Đầu B", ô cổng gợi ý cổng còn trống và báo ngay cổng đã có dây.
 */
describe('PortFormDialog ở màn sơ đồ (device = null)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function mockPorts() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/v1/devices/sw1/ports')) {
          return Promise.resolve(
            jsonResponse(200, {
              ports: [
                { id: 'r1', portLabel: 'Gi1/0/1', connectedDeviceId: 'x9', connectedDeviceCode: 'PC-E2E-09', connectedLabel: null, connectedPort: null },
                { id: 'r2', portLabel: 'Gi1/0/2', connectedDeviceId: null, connectedDeviceCode: null, connectedLabel: null, connectedPort: null },
              ],
              incoming: [],
            }),
          );
        }
        if (url.startsWith('/api/v1/catalog')) {
          return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: [] }));
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
  }

  it('Đầu A / Đầu B; chọn nhanh máy trên bản vẽ; cổng trống gợi ý, cổng đã có dây báo ngay kèm cổng kế tiếp', async () => {
    mockPorts();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <PortFormDialog
            device={null}
            port={null}
            csrfToken="t"
            onDrawing={[
              { id: 'sw1', code: 'SW-E2E-01' },
              { id: 'pc2', code: 'PC-E2E-02' },
            ]}
            onClose={() => {}}
            onSaved={() => {}}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const a = await screen.findByRole('group', { name: 'Đầu A — máy giữ bản ghi' });
    const b = screen.getByRole('group', { name: 'Đầu B — đầu kia' });
    // Dải chọn loại đầu nằm TRONG Đầu B, có nhãn.
    expect(within(b).getByRole('radiogroup', { name: 'Đầu kia là' })).toBeInTheDocument();
    expect(within(b).getByText('Đầu kia là')).toBeVisible();

    await user.click(within(a).getByRole('button', { name: 'SW-E2E-01' }));
    expect(within(a).getByRole('combobox', { name: 'Thiết bị' })).toHaveValue('SW-E2E-01');
    // Máy đã chọn ở Đầu A không mời lại ở Đầu B.
    expect(within(b).queryByRole('button', { name: 'SW-E2E-01' })).toBeNull();
    expect(await within(a).findByRole('button', { name: 'Gi1/0/2' })).toBeInTheDocument();
    await user.type(within(a).getByRole('textbox', { name: /Cổng/ }), 'Gi1/0/1');
    expect(await within(a).findByText('Gi1/0/1 của SW-E2E-01 đã nối PC-E2E-09.')).toBeInTheDocument();
    await user.click(within(a).getByRole('button', { name: 'Dùng Gi1/0/2' }));
    expect(within(a).getByRole('textbox', { name: /Cổng/ })).toHaveValue('Gi1/0/2');

    await user.click(within(b).getByRole('button', { name: 'PC-E2E-02' }));
    expect(within(b).getByRole('combobox', { name: 'Thiết bị đầu kia' })).toHaveValue('PC-E2E-02');
  });

  it('Cổng đầu kia: chọn máy đầu kia rồi ô gợi ý cổng còn trống của CHÍNH máy đó (như ô Cổng); tên ngoài danh sách báo trước', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('/api/v1/devices/pc2/port-panel')) {
          return Promise.resolve(
            jsonResponse(200, {
              ports: [
                { label: 'NIC1', kind: 'rj45', peer: 'SW-E2E-09 · Gi1/0/9' },
                { label: 'NIC2', kind: 'rj45', peer: null },
              ],
              unlisted: [],
              used: 1,
              total: 2,
            }),
          );
        }
        if (url.startsWith('/api/v1/devices/pc2/ports')) return Promise.resolve(jsonResponse(200, { ports: [], incoming: [] }));
        if (url.startsWith('/api/v1/catalog')) {
          return Promise.resolve(jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: [] }));
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <PortFormDialog device={null} port={null} csrfToken="t" onDrawing={[{ id: 'pc2', code: 'PC-E2E-02' }]} onClose={() => {}} onSaved={() => {}} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const b = await screen.findByRole('group', { name: 'Đầu B — đầu kia' });
    await user.click(within(b).getByRole('button', { name: 'PC-E2E-02' }));
    const peerPort = await within(b).findByRole('combobox', { name: 'Cổng đầu kia' });
    await user.click(peerPort);
    expect(await screen.findByRole('option', { name: 'NIC2' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'NIC1' })).toBeNull();
    await user.type(peerPort, 'eth9');
    expect(await within(b).findByText(/Cổng "eth9" chưa có trong danh sách cổng của PC-E2E-02/)).toBeInTheDocument();
  });

  it('đổi máy ở Đầu A / Đầu B thì ô cổng của đầu đó xoá trắng — cổng của máy cũ không đi theo sang máy mới', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { ports: [], incoming: [] }))));
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <PortFormDialog
            device={null}
            port={null}
            csrfToken="t"
            onDrawing={[
              { id: 'sw1', code: 'SW-E2E-01' },
              { id: 'sw2', code: 'SW-E2E-02' },
              { id: 'pc3', code: 'PC-E2E-03' },
            ]}
            onClose={() => {}}
            onSaved={() => {}}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    const a = await screen.findByRole('group', { name: 'Đầu A — máy giữ bản ghi' });
    const b = screen.getByRole('group', { name: 'Đầu B — đầu kia' });
    await user.click(within(a).getByRole('button', { name: 'SW-E2E-01' }));
    await user.type(portInput(), 'Gi1/0/5');
    await user.click(within(b).getByRole('button', { name: 'PC-E2E-03' }));
    const peerPort = () => document.getElementById('port-peer-port') as HTMLInputElement;
    await user.type(peerPort(), 'eth0');
    await user.click(within(a).getByRole('button', { name: 'SW-E2E-02' }));
    expect(portInput()).toHaveValue('');
    expect(peerPort()).toHaveValue('eth0');
    await user.click(within(b).getByRole('button', { name: 'SW-E2E-01' }));
    expect(peerPort()).toHaveValue('');
  });
});

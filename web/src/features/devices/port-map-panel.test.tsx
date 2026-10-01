import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { render, screen, userEvent, waitFor, within, jsonResponse } from '@/test/test-utils';
import i18n from '@/lib/i18n';
import type { DeviceRow } from '@/lib/device-types';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { PortMapPanel } from './port-map-panel';

const DEVICE = { id: 'd-1', code: 'SW-E2E-01', name: 'Switch', status: 'in_use' } as DeviceRow;

const PORTS = {
  ports: [
    {
      id: 'p-1',
      portLabel: 'WAN1',
      connectedDeviceId: null,
      connectedDeviceCode: null,
      connectedDeviceName: null,
      connectedLabel: 'uplink nhà mạng',
      connectedPort: null,
      usedBy: null,
      vlan: null,
      note: null,
    },
  ],
  incoming: [],
};

/*
 * Panel nằm ngay dưới h1 của trang thiết bị (tab không có tiêu đề riêng), nên hai khối của nó
 * là h2 như các khu ở tab Tổng quan. h3 thì trình đọc màn hình thấy một bậc bị bỏ trống.
 */
describe('PortMapPanel — bậc tiêu đề', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hai khối "cổng của máy" và "đang cắm vào" là h2', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, PORTS))));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <ToastProvider>
            <ConfirmProvider>
              <PortMapPanel device={DEVICE} csrfToken="t" canEdit />
            </ConfirmProvider>
          </ToastProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Cổng của thiết bị này' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Đang cắm vào thiết bị này' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('PortMapPanel — sửa cổng thì lịch sử máy phải đọc lại', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('xóa một cổng làm cũ luôn lịch sử + dòng thời gian của máy (tab Lịch sử không còn bản cũ)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'DELETE' ? jsonResponse(204, null) : jsonResponse(200, PORTS),
        ),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Trang chi tiết nạp lịch sử NGAY khi mở hồ sơ (để biết "từ khi nào", "sửa lần cuối").
    qc.setQueryData(['devices', DEVICE.id, 'history'], []);
    qc.setQueryData(['devices', DEVICE.id, 'timeline'], { entries: [] });

    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <ToastProvider>
            <ConfirmProvider>
              <PortMapPanel device={DEVICE} csrfToken="t" canEdit />
            </ConfirmProvider>
          </ToastProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Thao tác với WAN1/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    const ask = await screen.findByRole('dialog');
    await user.click(within(within(ask).getByTestId('dialog-footer')).getByRole('button', { name: 'Xóa' }));

    await waitFor(() =>
      expect(qc.getQueryState(['devices', DEVICE.id, 'history'])?.isInvalidated).toBe(true),
    );
    expect(qc.getQueryState(['devices', DEVICE.id, 'timeline'])?.isInvalidated).toBe(true);
  });
});

/* Q-20: một cổng một sợi cáp — API trả 409 kèm câu nêu cổng + máy đang giữ; form phải hiện
   nguyên câu đó, không thay bằng câu chung. */
describe('PortMapPanel — cổng đã có cáp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('409 PORT_ALREADY_LINKED → câu của server hiện trong form, form vẫn mở', async () => {
    const message =
      'Cổng "ETH0" của thiết bị này đã có cáp nối từ SW-E2E-01 cổng "Gi1/0/12". Mỗi cổng chỉ một sợi cáp — sửa hoặc gỡ dòng đó trước.';
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? jsonResponse(409, { code: 'PORT_ALREADY_LINKED', message })
            : jsonResponse(200, PORTS),
        ),
      ),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <ToastProvider>
            <ConfirmProvider>
              <PortMapPanel device={DEVICE} csrfToken="t" canEdit />
            </ConfirmProvider>
          </ToastProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Thêm cổng' }))[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /^Cổng(\s\*)?$/ }), 'ETH0');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  });
});

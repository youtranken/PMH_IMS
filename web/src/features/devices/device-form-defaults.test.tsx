import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, waitFor } from '@/test/test-utils';
import { DeviceForm } from './device-form';

const LISTS = {
  sites: [{ id: 's1', code: 'HCM', name: 'Văn phòng HCM', active: true }],
  cabinets: [],
  deviceTypes: [{ id: 't1', name: 'Laptop', hasPortMap: false, description: null, active: true }],
  vendors: [],
  departments: [],
  ispProviders: [],
  servicePorts: [],
};

/* FM-06: danh sách đang lọc theo một site mà form Thêm vẫn để Site "Chưa chọn" — bấm thừa. */
describe('Form thiết bị — Thêm mới lấy site đang lọc', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('presetSiteId → ô Site điền sẵn', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, LISTS))));
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DeviceForm device={null} presetSiteId="s1" csrfToken="t" onClose={() => {}} onSaved={() => {}} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const site = await screen.findByRole('button', { name: 'Site' });
    await waitFor(() => expect(site).toHaveTextContent('HCM — Văn phòng HCM'));
  });
});

/* FM-21: nhập hàng loạt phải nhớ số cuối — form Thêm điền sẵn mã kế tiếp; form Sửa không hỏi. */
describe('Form thiết bị — mã kế tiếp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Thêm mới: ô Mã điền sẵn mã gợi ý của /devices/next-code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(jsonResponse(200, String(input) === '/api/v1/devices/next-code' ? { code: 'PC-E2E-012' } : LISTS)),
      ),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DeviceForm device={null} csrfToken="t" onClose={() => {}} onSaved={() => {}} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByDisplayValue('PC-E2E-012')).toBeInTheDocument();
  });
});

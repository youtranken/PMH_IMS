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

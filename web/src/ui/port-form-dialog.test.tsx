import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { PortFormDialog } from '@/ui/port-form-dialog';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';

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

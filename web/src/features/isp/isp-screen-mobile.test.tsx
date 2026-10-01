import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { IspScreen } from './isp-screen';

/*
 * Màn đường truyền hay được mở trên điện thoại lúc mất mạng: ở 390px mỗi đường là một thẻ gọn
 * (mã · trạng thái, nhà mạng, site · thiết bị biên, nút gọi hotline) thay vì bảng gập 7 dòng.
 */

const me = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const LINE = {
  id: 'l1',
  code: 'ISP-E2E-01',
  provider: 'FPT Telecom',
  providerId: 'p-fpt',
  bandwidth: '300 Mbps',
  wanIp: '113.161.10.20',
  siteId: 's1',
  siteCode: 'HCM',
  deviceId: 'd-fw',
  deviceCode: 'FW-E2E-01',
  deviceName: 'Draytek',
  hotline: '19006600',
  contractNo: 'HD-123',
  startDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Danh sách đường truyền ở 390px', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mỗi đường là một thẻ: mã là link, trạng thái, nhà mạng, site · thiết bị, nút gọi', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).startsWith('/api/v1/isp-lines')
            ? jsonResponse(200, { items: [LINE], total: 1 })
            : jsonResponse(200, {}),
        ),
      ),
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/isp-lines']}>
        <ToastProvider>
          <ConfirmProvider>
            <IspScreen me={me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'ISP-E2E-01' });
    const card = link.closest('li');
    if (!(card instanceof HTMLElement)) throw new Error('không phải thẻ gọn');
    expect(card).toHaveClass('list-card');
    expect(card).toHaveTextContent('Đang dùng');
    expect(card).toHaveTextContent('FPT Telecom');
    expect(card).toHaveTextContent('HCM · FW-E2E-01');
    expect(within(card).getByRole('link', { name: /1900/ })).toHaveAttribute('href', 'tel:19006600');
  });
});

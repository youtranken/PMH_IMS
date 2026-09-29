import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

/*
 * Tìm "E2E" ra cả máy đang dùng lẫn máy đã thanh lý — dòng kết quả phải nói ra hồ sơ nào đã
 * bỏ (SHELL-018). Chỉ trạng thái cuối mới có chip, tên theo module chủ (như Kho thanh lý).
 */
describe('Tìm nhanh — chip trạng thái cuối', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('thiết bị đã thanh lý và tài khoản dịch vụ đã ngừng dùng có chip; hồ sơ đang dùng thì không', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/devices?')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                { id: 'd1', code: 'SW-E2E-OLD', name: 'Switch cũ', siteCode: null, status: 'retired' },
                { id: 'd2', code: 'SW-E2E-NEW', name: 'Switch mới', siteCode: null, status: 'in_use' },
              ],
              total: 2,
            }),
          );
        }
        if (url.includes('/api/v1/service-accounts?')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [{ id: 's1', code: 'VPN-E2E-01', name: 'VPN', login: null, status: 'disabled' }],
              total: 1,
            }),
          );
        }
        if (url.includes('/api/v1/ipam/subnets')) return Promise.resolve(jsonResponse(200, []));
        if (url.includes('/api/v1/ipam/addresses')) return Promise.resolve(jsonResponse(200, []));
        return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
      }),
    );
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ConfirmProvider>
          <CommandPalette me={me} />
        </ConfirmProvider>
      </MemoryRouter>,
    );
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), 'E2E');

    const devices = await screen.findByRole('group', { name: 'Thiết bị' });
    expect(within(devices).getByRole('option', { name: /^SW-E2E-OLD/ })).toHaveTextContent('Đã thanh lý');
    expect(within(devices).getByRole('option', { name: /^SW-E2E-NEW/ })).not.toHaveTextContent('Đã');
    const accounts = await screen.findByRole('group', { name: 'Tài khoản dịch vụ' });
    expect(within(accounts).getByRole('option', { name: /^VPN-E2E-01/ })).toHaveTextContent(
      'Đã ngừng dùng',
    );
  });
});

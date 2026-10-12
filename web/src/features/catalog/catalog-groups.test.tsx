import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { CatalogScreen } from './catalog-screen';

/**
 * Danh mục gom 3 nhóm (Q-27): Vị trí · Thiết bị · Đối tác & tổ chức, vẫn là một thanh tab; đầu
 * màn có thẻ "Khai trước khi thêm thiết bị" nói danh mục nào đủ, danh mục nào còn thiếu.
 */

const SA = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname === '/api/v1/catalog') {
        return Promise.resolve(
          jsonResponse(200, {
            sites: [{ id: 's1', code: 'LST', name: 'Văn phòng', active: true }],
            cabinets: [],
            deviceTypes: [{ id: 't1', name: 'Server', active: true }],
            vendors: [{ id: 'v1', name: 'NCC', active: true }],
            departments: [],
            ispProviders: [],
            servicePorts: [],
            cableTypes: [],
          }),
        );
      }
      if (url.pathname === '/api/v1/device-models') {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              { id: 'm1', model: 'A', photoFrontFileId: 'f1' },
              { id: 'm2', model: 'B', photoFrontFileId: null },
            ],
            total: 2,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
}

function Address() {
  return <output aria-label="địa chỉ">{useLocation().search}</output>;
}

function renderAt(entry: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <CatalogScreen me={SA} />
          <Address />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Danh mục — 3 nhóm (Q-27)', () => {
  it('thứ tự tab theo nhóm: Vị trí → Thiết bị (kể cả Model) → Đối tác & tổ chức', async () => {
    stubFetch();
    renderAt('/admin/catalog');
    const list = await screen.findByRole('tablist', { name: 'Danh mục' });
    const names = within(list).getAllByRole('tab').map((tab) => tab.textContent?.replace(/\s*\d+$/, '').trim());
    expect(names).toEqual([
      'Site', 'Tủ mạng',
      'Loại thiết bị', 'Model thiết bị', 'Loại dây', 'Cổng dịch vụ (port)',
      'Nhà cung cấp', 'Nhà mạng', 'Phòng ban',
    ]);
    expect(Array.from(list.querySelectorAll('.tab-group')).map((el) => el.textContent)).toEqual([
      'Vị trí', 'Thiết bị', 'Đối tác & tổ chức',
    ]);
  });

  it('thẻ "Khai trước khi thêm thiết bị": đủ / chưa có / model chưa có ảnh; bấm ô thì sang đúng tab', async () => {
    stubFetch();
    renderAt('/admin/catalog');
    const card = await screen.findByRole('region', { name: 'Khai trước khi thêm thiết bị' });
    expect(await within(card).findByRole('button', { name: /^Site/ })).toHaveTextContent('1 · đủ');
    expect(within(card).getByRole('button', { name: /^Tủ mạng/ })).toHaveTextContent('chưa có');
    expect(await within(card).findByRole('button', { name: /^Model thiết bị/ })).toHaveTextContent('1 chưa có ảnh');
    await userEvent.setup().click(within(card).getByRole('button', { name: /^Tủ mạng/ }));
    expect(screen.getByLabelText('địa chỉ')).toHaveTextContent('tab=cabinet');
  });
});

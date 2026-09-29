import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { CatalogScreen } from './catalog-screen';

const SA = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const site = (id: string) => ({ id, code: `E2E-${id}`, name: id, address: null, active: true });

/*
 * Người mới vào Danh mục cần biết ngay bảy nhóm nào đã khai và nhóm nào còn trống — số trên
 * nhãn từng tab. Nhóm trống thì không vẽ "0" (luật chung của `Tabs`).
 */
describe('Danh mục — số mục trên nhãn tab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mỗi tab mang số mục của nhóm đó; nhóm rỗng không kèm số; nút Thêm có bề ngang cố định', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://x');
        if (url.pathname === '/api/v1/catalog') {
          return Promise.resolve(
            jsonResponse(200, {
              sites: [site('a'), site('b'), site('c')],
              cabinets: [],
              deviceTypes: [{ id: 't1' }],
              vendors: [],
              departments: [],
              ispProviders: [],
              servicePorts: [],
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
      }),
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/admin/catalog']}>
        <ToastProvider>
          <ConfirmProvider>
            <CatalogScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('tab', { name: 'Site 3' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Loại thiết bị 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm site' })).toHaveClass('catalog-add');
  });
});
